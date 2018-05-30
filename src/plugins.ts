import * as fs from 'mz/fs'
import * as path from 'path'
import * as ts from 'typescript'
import { Logger, NoopLogger } from './logging'
import { combinePaths } from './match-files'
import { PluginSettings } from './request-type'
import { toUnixPath } from './util'

// Based on types and logic from TypeScript server/project.ts @
// https://github.com/Microsoft/TypeScript/blob/711e890e59e10aa05a43cb938474a3d9c2270429/src/server/project.ts

/**
 * A plugin exports an initialization function, injected with
 * the current typescript instance
 */
export type PluginModuleFactory = (mod: { typescript: typeof ts }) => PluginModule

export type EnableProxyFunc = (pluginModuleFactory: PluginModuleFactory, pluginConfigEntry: ts.PluginImport) => void

/**
 * A plugin presents this API when initialized
 */
export interface PluginModule {
    create(createInfo: PluginCreateInfo): ts.LanguageService
    getExternalFiles?(proj: Project): string[]
}

/**
 * All of tsserver's environment exposed to plugins
 */
export interface PluginCreateInfo {
    project: Project
    languageService: ts.LanguageService
    languageServiceHost: ts.LanguageServiceHost
    serverHost: ServerHost
    config: any
}

/**
 * The portion of tsserver's Project API exposed to plugins
 */
export interface Project {
    projectService: { logger: Logger }
    getCurrentDirectory(): string
}

/**
 * A local filesystem-based ModuleResolutionHost for plugin loading.
 */
export class LocalModuleResolutionHost implements ts.ModuleResolutionHost {
    public fileExists(fileName: string): boolean {
        return fs.existsSync(fileName)
    }
    public readFile(fileName: string): string {
        return fs.readFileSync(fileName, 'utf8')
    }
}

/**
 * The portion of tsserver's ServerHost API exposed to plugins
 */
export type ServerHost = object

/**
 * The result of a node require: a module or an error.
 */
type RequireResult = { module: {}; error: undefined } | { module: undefined; error: {} }

export class PluginLoader {
    private allowLocalPluginLoads = false
    private globalPlugins: string[] = []
    private pluginProbeLocations: string[] = []

    constructor(
        private rootFilePath: string,
        private fs: ts.ModuleResolutionHost,
        pluginSettings?: PluginSettings,
        private logger = new NoopLogger(),
        private resolutionHost = new LocalModuleResolutionHost(),
        private requireModule: (moduleName: string) => any = require
    ) {
        if (pluginSettings) {
            this.allowLocalPluginLoads = pluginSettings.allowLocalPluginLoads || false
            this.globalPlugins = pluginSettings.globalPlugins || []
            this.pluginProbeLocations = pluginSettings.pluginProbeLocations || []
        }
    }

    public loadPlugins(options: ts.CompilerOptions, applyProxy: EnableProxyFunc): void {
        // Search our peer node_modules, then any globally-specified probe paths
        // ../../.. to walk from X/node_modules/javascript-typescript-langserver/lib/project-manager.js to X/node_modules/
        const searchPaths = [combinePaths(__filename, '../../..'), ...this.pluginProbeLocations]

        // Corresponds to --allowLocalPluginLoads, opt-in to avoid remote code execution.
        if (this.allowLocalPluginLoads) {
            const local = this.rootFilePath
            this.logger.info(`Local plugin loading enabled; adding ${local} to search paths`)
            searchPaths.unshift(local)
        }

        let pluginImports: ts.PluginImport[] = []
        if (options.plugins) {
            pluginImports = options.plugins as ts.PluginImport[]
        }

        // Enable tsconfig-specified plugins
        if (options.plugins) {
            for (const pluginConfigEntry of pluginImports) {
                this.enablePlugin(pluginConfigEntry, searchPaths, applyProxy)
            }
        }

        if (this.globalPlugins) {
            // Enable global plugins with synthetic configuration entries
            for (const globalPluginName of this.globalPlugins) {
                // Skip already-locally-loaded plugins
                if (!pluginImports || pluginImports.some(p => p.name === globalPluginName)) {
                    continue
                }

                // Provide global: true so plugins can detect why they can't find their config
                this.enablePlugin({ name: globalPluginName, global: true } as ts.PluginImport, searchPaths, applyProxy)
            }
        }
    }

    /**
     * Tries to load and enable a single plugin
     * @param pluginConfigEntry
     * @param searchPaths
     */
    private enablePlugin(
        pluginConfigEntry: ts.PluginImport,
        searchPaths: string[],
        enableProxy: EnableProxyFunc
    ): void {
        for (const searchPath of searchPaths) {
            const resolvedModule = this.resolveModule(pluginConfigEntry.name, searchPath) as PluginModuleFactory
            if (resolvedModule) {
                enableProxy(resolvedModule, pluginConfigEntry)
                return
            }
        }
        this.logger.error(`Couldn't find ${pluginConfigEntry.name} anywhere in paths: ${searchPaths.join(',')}`)
    }

    /**
     * Load a plugin using a node require
     * @param moduleName
     * @param initialDir
     */
    private resolveModule(moduleName: string, initialDir: string): {} | undefined {
        const resolvedPath = toUnixPath(path.resolve(combinePaths(initialDir, 'node_modules')))
        this.logger.info(`Loading ${moduleName} from ${initialDir} (resolved to ${resolvedPath})`)
        const result = this.requirePlugin(resolvedPath, moduleName)
        if (result.error) {
            this.logger.error(`Failed to load module: ${JSON.stringify(result.error)}`)
            return undefined
        }
        return result.module
    }

    /**
     * Resolves a loads a plugin function relative to initialDir
     * @param initialDir
     * @param moduleName
     */
    private requirePlugin(initialDir: string, moduleName: string): RequireResult {
        try {
            const modulePath = this.resolveJavaScriptModule(moduleName, initialDir, this.fs)
            return { module: this.requireModule(modulePath), error: undefined }
        } catch (error) {
            return { module: undefined, error }
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
        const result = ts.nodeModuleNameResolver(
            moduleName,
            initialDir.replace('\\', '/') + '/package.json' /* containingFile */,
            { moduleResolution: ts.ModuleResolutionKind.NodeJs, allowJs: true },
            this.resolutionHost,
            undefined
        )
        if (!result.resolvedModule) {
            // this.logger.error(result.failedLookupLocations);
            throw new Error(`Could not resolve JS module ${moduleName} starting at ${initialDir}.`)
        }
        return result.resolvedModule.resolvedFileName
    }
}
