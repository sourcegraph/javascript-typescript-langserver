import * as ts from 'typescript';
import { Logger, NoopLogger } from './logging';
import { combinePaths } from './match-files';
import { InitializationOptions } from './request-type';

// definitions from from TypeScript server/project.ts

/**
 * A plugin exports an initialization function, injected with
 * the current typescript instance
 */
export type PluginModuleFactory = (mod: { typescript: typeof ts }) => PluginModule;

export type EnableProxyFunc = (pluginModuleFactory: PluginModuleFactory, pluginConfigEntry: ts.PluginImport) => void;

/**
 * A plugin presents this API when initialized
 */
export interface PluginModule {
	create(createInfo: PluginCreateInfo): ts.LanguageService;
	getExternalFiles?(proj: Project): string[];
}

/**
 * All of tsserver's environment exposed to plugins
 */
export interface PluginCreateInfo {
	project: Project;
	languageService: ts.LanguageService;
	languageServiceHost: ts.LanguageServiceHost;
	serverHost: ServerHost;
	config: any;
}

/**
 * The portion of tsserver's Project API exposed to plugins
 */
export interface Project {
	projectService: {
		logger: Logger;
	};
}

/**
 * The portion of tsserver's ServerHost API exposed to plugins
 */
export type ServerHost = object;

/**
 * The result of a node require: a module or an error.
 */
type RequireResult = { module: {}, error: undefined } | { module: undefined, error: {} };

export class PluginLoader {

	public allowLocalPluginLoads: boolean = false;
	public globalPlugins: string[] = [];
	public pluginProbeLocations: string[] = [];
	public require: (path: string) => any = require;

	constructor(private rootFilePath: string, private fs: ts.ModuleResolutionHost, initializationOptions?: InitializationOptions, private logger = new NoopLogger()) {
		if (initializationOptions) {
			this.allowLocalPluginLoads = initializationOptions.allowLocalPluginLoads || false;
			this.globalPlugins = initializationOptions.globalPlugins || [];
			this.pluginProbeLocations = initializationOptions.pluginProbeLocations || [];
		}
	}

	public loadPlugins(options: ts.CompilerOptions, applyProxy: EnableProxyFunc) {
		// Search our peer node_modules, then any globally-specified probe paths
		// ../../.. to walk from X/node_modules/javascript-typescript-langserver/lib/project-manager.js to X/node_modules/
		const searchPaths = [combinePaths(__filename, '../../..'), ...this.pluginProbeLocations];

		// Corresponds to --allowLocalPluginLoads, opt-in to avoid remote code execution.
		if (this.allowLocalPluginLoads) {
			const local = this.rootFilePath;
			this.logger.info(`Local plugin loading enabled; adding ${local} to search paths`);
			searchPaths.unshift(local);
		}

		let pluginImports: ts.PluginImport[] = [];
		if (options.plugins) {
			pluginImports = options.plugins as ts.PluginImport[];
		}

		// Enable tsconfig-specified plugins
		if (options.plugins) {
			for (const pluginConfigEntry of pluginImports) {
				this.enablePlugin(pluginConfigEntry, searchPaths, applyProxy);
			}
		}

		if (this.globalPlugins) {
			// Enable global plugins with synthetic configuration entries
			for (const globalPluginName of this.globalPlugins) {
				// Skip already-locally-loaded plugins
				if (!pluginImports || pluginImports.some(p => p.name === globalPluginName)) {
					continue;
				}

				// Provide global: true so plugins can detect why they can't find their config
				this.enablePlugin({ name: globalPluginName, global: true } as ts.PluginImport, searchPaths, applyProxy);
			}
		}
	}

	/**
	 * Tries to load and enable a single plugin
	 * @param pluginConfigEntry
	 * @param searchPaths
	 */
	private enablePlugin(pluginConfigEntry: ts.PluginImport, searchPaths: string[], enableProxy: EnableProxyFunc) {
		for (const searchPath of searchPaths) {
			const resolvedModule =  this.resolveModule(pluginConfigEntry.name, searchPath) as PluginModuleFactory;
			if (resolvedModule) {
				enableProxy(resolvedModule, pluginConfigEntry);
				return;
			}
		}
		this.logger.info(`Couldn't find ${pluginConfigEntry.name} anywhere in paths: ${searchPaths.join(',')}`);
	}

	/**
	 * Load a plugin using a node require
	 * @param moduleName
	 * @param initialDir
	 */
	private resolveModule(moduleName: string, initialDir: string): {} | undefined {
		this.logger.info(`Loading ${moduleName} from ${initialDir}`);
		const result = this.requirePlugin(initialDir, moduleName);
		if (result.error) {
			this.logger.info(`Failed to load module: ${JSON.stringify(result.error)}`);
			return undefined;
		}
		return result.module;
	}

	/**
	 * Resolves a loads a plugin function relative to initialDir
	 * @param initialDir
	 * @param moduleName
	 */
	private requirePlugin(initialDir: string, moduleName: string): RequireResult {
		const modulePath = this.resolveJavaScriptModule(moduleName, initialDir, this.fs);
		try {
			return { module: this.require(modulePath), error: undefined };
		} catch (error) {
			return { module: undefined, error };
		}
	}

	/**
	 * Expose resolution logic to allow us to use Node module resolution logic from arbitrary locations.
	 * No way to do this with `require()`: https://github.com/nodejs/node/issues/5963
	 * Throws an error if the module can't be resolved.
	 * stolen from moduleNameResolver.ts because marked as internal
	 */
	private resolveJavaScriptModule(moduleName: string, initialDir: string, host: ts.ModuleResolutionHost): string {
		// TODO: this should set jsOnly=true to the internal resolver, but this parameter is not exposed on a public api.
		const result =
			ts.nodeModuleNameResolver(moduleName, /* containingFile */ initialDir.replace('\\', '/') + '/package.json', { moduleResolution: ts.ModuleResolutionKind.NodeJs, allowJs: true }, this.fs, undefined);
		if (!result.resolvedModule) {
			// this.logger.error(result.failedLookupLocations);
			throw new Error(`Could not resolve JS module ${moduleName} starting at ${initialDir}.`);
		}
		return result.resolvedModule.resolvedFileName;
	}
}
