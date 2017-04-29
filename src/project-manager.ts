import { Observable } from '@reactivex/rxjs';
import iterate from 'iterare';
import { Span } from 'opentracing';
import * as os from 'os';
import * as path_ from 'path';
import * as ts from 'typescript';
import { Disposable } from 'vscode-languageserver';
import { URL } from 'whatwg-url';
import { FileSystemUpdater } from './fs';
import { Logger, NoopLogger } from './logging';
import { InMemoryFileSystem } from './memfs';
import * as util from './util';

export type ConfigType = 'js' | 'ts';

/**
 * ProjectManager translates VFS files to one or many projects denoted by [tj]config.json.
 * It uses either local or remote file system to fetch directory tree and files from and then
 * makes one or more LanguageService objects. By default all LanguageService objects contain no files,
 * they are added on demand - current file for hover or definition, project's files for references and
 * all files from all projects for workspace symbols.
 */
export class ProjectManager implements Disposable {

	/**
	 * Root path (as passed to `initialize` request)
	 */
	private rootPath: string;

	/**
	 * (Workspace subtree (folder) -> TS or JS configuration) mapping.
	 * Configuration settings for a source file A are located in the closest parent folder of A.
	 * Map keys are relative (to workspace root) paths
	 */
	private configs = {
		js: new Map<string, ProjectConfiguration>(),
		ts: new Map<string, ProjectConfiguration>()
	};

	/**
	 * When on, indicates that client is responsible to provide file content (VFS),
	 * otherwise we are working with a local file system
	 */
	private strict: boolean;

	/**
	 * Local side of file content provider which keeps cache of fetched files
	 */
	private localFs: InMemoryFileSystem;

	/**
	 * File system updater that takes care of updating the in-memory file system
	 */
	private updater: FileSystemUpdater;

	/**
	 * URI -> version map. Every time file content is about to change or changed (didChange/didOpen/...), we are incrementing it's version
	 * signalling that file is changed and file's user must invalidate cached and requery file content
	 */
	private versions: Map<string, number>;

	/**
	 * Enables module resolution tracing by TS compiler
	 */
	private traceModuleResolution: boolean;

	/**
	 * Flag indicating that we fetched module struture (tsconfig.json, jsconfig.json, package.json files) from the remote file system.
	 * Without having this information we won't be able to split workspace to sub-projects
	 */
	private ensuredModuleStructure?: Promise<void>;

	/**
	 * Promise resolved when `ensureAllFiles` completed
	 */
	private ensuredAllFiles?: Promise<void>;

	/**
	 * Promise resolved when `ensureOwnFiles` completed
	 */
	private ensuredOwnFiles?: Promise<void>;

	/**
	 * A URI Map from file to files referenced by the file, so files only need to be pre-processed once
	 */
	private referencedFiles = new Map<string, Observable<URL>>();

	/**
	 * @param rootPath root path as passed to `initialize`
	 * @param inMemoryFileSystem File system that keeps structure and contents in memory
	 * @param strict indicates if we are working in strict mode (VFS) or with a local file system
	 * @param traceModuleResolution allows to enable module resolution tracing (done by TS compiler)
	 */
	constructor(private rootUri: URL, rootPath: string, inMemoryFileSystem: InMemoryFileSystem, updater: FileSystemUpdater, strict: boolean, traceModuleResolution?: boolean, protected logger: Logger = new NoopLogger()) {
		this.rootPath = util.toUnixPath(rootPath);
		this.updater = updater;
		this.localFs = inMemoryFileSystem;
		this.versions = new Map<string, number>();
		this.strict = strict;
		this.traceModuleResolution = traceModuleResolution || false;
	}

	/**
	 * Disposes the object and cancels any asynchronous operations that are still active
	 */
	dispose(): void {
		// TODO unsubscribe subscriptions
	}

	/**
	 * @return root path (as passed to `initialize`)
	 */
	getRemoteRoot(): string {
		return this.rootPath;
	}

	/**
	 * @return local side of file content provider which keeps cached copies of fethed files
	 */
	getFs(): InMemoryFileSystem {
		return this.localFs;
	}

	/**
	 * @param filePath file path (both absolute or relative file paths are accepted)
	 * @return true if there is a fetched file with a given path
	 */
	hasFile(filePath: string) {
		return this.localFs.fileExists(filePath);
	}

	/**
	 * @return all sub-projects we have identified for a given workspace.
	 * Sub-project is mainly a folder which contains tsconfig.json, jsconfig.json, package.json,
	 * or a root folder which serves as a fallback
	 */
	configurations(): IterableIterator<ProjectConfiguration> {
		return iterate(this.configs.js.values()).concat(this.configs.ts.values());
	}

	/**
	 * Ensures that the module structure of the project exists in memory.
	 * TypeScript/JavaScript module structure is determined by [jt]sconfig.json,
	 * filesystem layout, global*.d.ts and package.json files.
	 * Then creates new ProjectConfigurations, resets existing and invalidates file references.
	 */
	ensureModuleStructure(childOf = new Span()): Promise<void> {
		if (this.ensuredModuleStructure) {
			return this.ensuredModuleStructure;
		}
		this.ensuredModuleStructure = (async () => {
			const span = childOf.tracer().startSpan('Ensure module structure', { childOf });
			try {
				await this.updater.ensureStructure();
				// Ensure content of all all global .d.ts, [tj]sconfig.json, package.json files
				await Promise.all(
					iterate(this.localFs.uris())
						.filter(uri => util.isGlobalTSFile(uri.pathname) || util.isConfigFile(uri.pathname) || util.isPackageJsonFile(uri.pathname))
						.map(uri => this.updater.ensure(uri))
				);
				// Scan for [tj]sconfig.json files
				this.createConfigurations();
				// Reset all compilation state
				// TODO utilize incremental compilation instead
				for (const config of this.configurations()) {
					config.reset();
				}
				// Require re-processing of file references
				this.invalidateReferencedFiles();
			} catch (err) {
				this.ensuredModuleStructure = undefined;
				span.setTag('error', true);
				span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
				throw err;
			} finally {
				span.finish();
			}
		})();
		return this.ensuredModuleStructure;
	}

	/**
	 * Invalidates caches for `ensureModuleStructure`, `ensureAllFiles` and `insureOwnFiles`
	 */
	invalidateModuleStructure(): void {
		this.ensuredModuleStructure = undefined;
		this.ensuredAllFiles = undefined;
		this.ensuredOwnFiles = undefined;
	}

	/**
	 * Ensures all files not in node_modules were fetched.
	 * This includes all js/ts files, tsconfig files and package.json files.
	 * Invalidates project configurations after execution
	 */
	async ensureOwnFiles(childOf = new Span()): Promise<void> {
		if (!this.ensuredOwnFiles) {
			this.ensuredOwnFiles = (async () => {
				const span = childOf.tracer().startSpan('Ensure own files', { childOf });
				try {
					await this.updater.ensureStructure(span);
					await Promise.all(
						iterate(this.localFs.uris())
							.filter(uri => !uri.pathname.includes('/node_modules/') && util.isJSTSFile(uri.pathname) || util.isConfigFile(uri.pathname) || util.isPackageJsonFile(uri.pathname))
							.map(uri => this.updater.ensure(uri))
					);
					this.createConfigurations();
				} catch (err) {
					this.ensuredOwnFiles = undefined;
					span.setTag('error', true);
					span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
					throw err;
				} finally {
					span.finish();
				}
			})();
		}
		return this.ensuredOwnFiles;
	}

	/**
	 * Ensures all files were fetched from the remote file system.
	 * Invalidates project configurations after execution
	 */
	ensureAllFiles(childOf = new Span()): Promise<void> {
		if (this.ensuredAllFiles) {
			return this.ensuredAllFiles;
		}
		this.ensuredAllFiles = (async () => {
			const span = childOf.tracer().startSpan('Ensure all files', { childOf });
			try {
				await this.updater.ensureStructure(span);
				await Promise.all(
					iterate(this.localFs.uris())
						.filter(uri => util.isJSTSFile(uri.pathname) || util.isConfigFile(uri.pathname) || util.isPackageJsonFile(uri.pathname))
						.map(uri => this.updater.ensure(uri))
				);
				this.createConfigurations();
			} catch (err) {
				this.ensuredAllFiles = undefined;
				span.setTag('error', true);
				span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
				throw err;
			} finally {
				span.finish();
			}
		})();
		return this.ensuredAllFiles;
	}

	/**
	 * Recursively collects file(s) dependencies up to given level.
	 * Dependencies are extracted by TS compiler from import and reference statements
	 *
	 * Dependencies include:
	 * - all the configuration files
	 * - files referenced by the given file
	 * - files included by the given file
	 *
	 * The return values of this method are not cached, but those of the file fetching and file processing are.
	 *
	 * @param uri File to process
	 * @param maxDepth Stop collecting when reached given recursion level
	 * @param ignore Tracks visited files to prevent cycles
	 * @param childOf OpenTracing parent span for tracing
	 * @return Observable of file URIs ensured
	 */
	ensureReferencedFiles(uri: URL, maxDepth = 30, ignore = new Set<string>(), childOf = new Span()): Observable<string> {
		const span = childOf.tracer().startSpan('Ensure referenced files', { childOf });
		span.addTags({ uri, maxDepth });
		ignore.add(uri.href);
		return Observable.from(this.ensureModuleStructure(span))
			// If max depth was reached, don't go any further
			.mergeMap(() => maxDepth === 0 ? [] : this.resolveReferencedFiles(uri, span))
			// Prevent cycles
			.filter(referencedUri => !ignore.has(referencedUri.href))
			// Call method recursively with one less dep level
			.mergeMap(referencedUri =>
				this.ensureReferencedFiles(referencedUri, maxDepth - 1, ignore)
					// Continue even if an import wasn't found
					.catch(err => {
						this.logger.error(`Error resolving file references for ${uri}:`, err);
						return [];
					})
			)
			// Log errors to span
			.catch(err => {
				span.setTag('error', true);
				span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
				throw err;
			})
			// Finish span
			.finally(() => {
				span.finish();
			});
	}

	/**
	 * Invalidates a cache entry for `resolveReferencedFiles` (e.g. because the file changed)
	 *
	 * @param uri The URI that referenced files should be invalidated for. If not given, all entries are invalidated
	 */
	invalidateReferencedFiles(uri?: string): void {
		if (uri) {
			this.referencedFiles.delete(uri);
		} else {
			this.referencedFiles.clear();
		}
	}

	/**
	 * Returns the files that are referenced from a given file.
	 * If the file has already been processed, returns a cached value.
	 *
	 * @param uri URI of the file to process
	 * @return URIs of files referenced by the file
	 */
	private resolveReferencedFiles(uri: URL, span = new Span()): Observable<URL> {
		let observable = this.referencedFiles.get(uri.href);
		if (observable) {
			return observable;
		}
		// TypeScript works with file paths, not URIs
		const filePath = uri.pathname.split('/').map(decodeURIComponent).join('/');
		observable = Observable.from(this.updater.ensure(uri))
			.mergeMap(() => {
				const config = this.getConfiguration(filePath);
				config.ensureBasicFiles(span);
				const contents = this.localFs.getContent(uri);
				const info = ts.preProcessFile(contents, true, true);
				const compilerOpt = config.getHost().getCompilationSettings();
				// TODO remove platform-specific behavior here, the host OS is not coupled to the client OS
				const resolver = !this.strict && os.platform() === 'win32' ? path_ : path_.posix;
				// Iterate imported files
				return Observable.merge(
					// References with `import`
					Observable.from(info.importedFiles)
						.map(importedFile => ts.resolveModuleName(util.toUnixPath(importedFile.fileName), filePath, compilerOpt, config.moduleResolutionHost()))
						// false means we didn't find a file defining the module. It
						// could still exist as an ambient module, which is why we
						// fetch global*.d.ts files.
						.filter(resolved => !!(resolved && resolved.resolvedModule))
						.map(resolved => resolved.resolvedModule!.resolvedFileName),
					// References with `<reference path="..."/>`
					Observable.from(info.referencedFiles)
						// Resolve triple slash references relative to current file
						// instead of using module resolution host because it behaves
						// differently in "nodejs" mode
						.map(referencedFile => resolver.resolve(
							this.rootPath,
							resolver.dirname(filePath),
							util.toUnixPath(referencedFile.fileName)
						)),
					// References with `<reference types="..."/>`
					Observable.from(info.typeReferenceDirectives)
						.map(typeReferenceDirective =>
							ts.resolveTypeReferenceDirective(
								typeReferenceDirective.fileName,
								filePath,
								compilerOpt,
								config.moduleResolutionHost()
							)
						)
						.filter(resolved => !!(resolved && resolved.resolvedTypeReferenceDirective && resolved.resolvedTypeReferenceDirective.resolvedFileName))
						.map(resolved => resolved.resolvedTypeReferenceDirective!.resolvedFileName!)
				);
			})
			// Use same scheme, slashes, host for referenced URI as input file
			.map(filePath => new URL(filePath.split(/[\\\/]/).map(encodeURIComponent).join('/'), uri.href))
			// Don't cache errors
			.catch<URL, never>(err => {
				this.referencedFiles.delete(uri.href);
				throw err;
			})
			// Make sure all subscribers get the same values
			.publishReplay()
			.refCount();
		this.referencedFiles.set(uri.href, observable);
		return observable;
	}

	/**
	 * @param filePath source file path, absolute
	 * @return project configuration for a given source file. Climbs directory tree up to workspace root if needed
	 */
	getConfiguration(filePath: string, configType: ConfigType = this.getConfigurationType(filePath)): ProjectConfiguration {
		const config = this.getConfigurationIfExists(filePath, configType);
		if (!config) {
			throw new Error(`TypeScript config file for ${filePath} not found`);
		}
		return config;
	}

	/**
	 * @param filePath source file path, absolute
	 * @return closest configuration for a given file path or undefined if there is no such configuration
	 */
	private getConfigurationIfExists(filePath: string, configType = this.getConfigurationType(filePath)): ProjectConfiguration | undefined {
		let dir = util.toUnixPath(filePath);
		let config;
		const configs = this.configs[configType];
		if (!configs) {
			return undefined;
		}
		const rootPath = this.rootPath.replace(/\/+$/, '');
		while (dir && dir !== rootPath) {
			config = configs.get(dir);
			if (config) {
				return config;
			}
			const pos = dir.lastIndexOf('/');
			if (pos <= 0) {
				dir = '';
			} else {
				dir = dir.substring(0, pos);
			}
		}
		return configs.get(rootPath);
	}

	/**
	 * Called when file was opened by client. Current implementation
	 * does not differenciates open and change events
	 * @param uri file's URI
	 * @param text file's content
	 */
	didOpen(uri: URL, text: string) {
		this.didChange(uri, text);
	}

	/**
	 * Called when file was closed by client. Current implementation invalidates compiled version
	 * @param uri file's URI
	 */
	didClose(uri: URL, span = new Span()) {
		const filePath = util.uri2path(uri);
		this.localFs.didClose(uri);
		let version = this.versions.get(uri.href) || 0;
		this.versions.set(uri.href, ++version);
		const config = this.getConfigurationIfExists(filePath);
		if (!config) {
			return;
		}
		config.ensureConfigFile(span);
		config.getHost().incProjectVersion();
		config.syncProgram(span);
	}

	/**
	 * Called when file was changed by client. Current implementation invalidates compiled version
	 * @param uri file's URI
	 * @param text file's content
	 */
	didChange(uri: URL, text: string, span = new Span()) {
		const filePath = util.uri2path(uri);
		this.localFs.didChange(uri, text);
		let version = this.versions.get(uri.href) || 0;
		this.versions.set(uri.href, ++version);
		const config = this.getConfigurationIfExists(filePath);
		if (!config) {
			return;
		}
		config.ensureConfigFile(span);
		config.getHost().incProjectVersion();
		config.syncProgram(span);
	}

	/**
	 * Called when file was saved by client
	 * @param uri file's URI
	 */
	didSave(uri: URL) {
		this.localFs.didSave(uri);
	}

	/**
	 * Detects projects and creates projects denoted by tsconfig.json and jsconfig.json fiels.
	 * Previously detected projects are NOT discarded.
	 * If there is no root configuration, adds it to catch all orphan files
	 */
	createConfigurations() {
		for (const uri of this.localFs.uris()) {
			const filePath = util.uri2path(uri);
			if (!/(^|\/)[tj]sconfig\.json$/.test(filePath)) {
				continue;
			}
			if (/(^|\/)node_modules\//.test(filePath)) {
				continue;
			}
			let dir = util.toUnixPath(filePath);
			const pos = dir.lastIndexOf('/');
			if (pos <= 0) {
				dir = '';
			} else {
				dir = dir.substring(0, pos);
			}
			const configType = this.getConfigurationType(filePath);
			const configs = this.configs[configType];
			configs.set(dir, new ProjectConfiguration(this.rootUri, this.localFs, dir, this.versions, filePath, undefined, this.traceModuleResolution, this.logger));
		}

		const rootPath = this.rootPath.replace(/\/+$/, '');
		for (const configType of ['js', 'ts'] as ConfigType[]) {
			const configs = this.configs[configType];
			if (!configs.has(rootPath)) {
				const tsConfig: any = {
					compilerOptions: {
						module: ts.ModuleKind.CommonJS,
						allowNonTsExtensions: false,
						allowJs: configType === 'js'
					}
				};
				tsConfig.include = { js: ['**/*.js', '**/*.jsx'], ts: ['**/*.ts', '**/*.tsx'] }[configType];
				// if there is at least one config, giving no files to default one
				// TODO: it makes impossible to IntelliSense gulpfile.js if there is a tsconfig.json in subdirectory
				if (configs.size > 0) {
					tsConfig.exclude = ['**/*'];
				}
				configs.set(rootPath, new ProjectConfiguration(this.rootUri, this.localFs, this.rootPath, this.versions, '', tsConfig, this.traceModuleResolution, this.logger));
			}

		}
	}

	/**
	 * @param filePath path to source (or config) file
	 * @return configuration type to use for a given file
	 */
	private getConfigurationType(filePath: string): ConfigType {
		const name = path_.posix.basename(filePath);
		if (name === 'tsconfig.json') {
			return 'ts';
		} else if (name === 'jsconfig.json') {
			return 'js';
		}
		const extension = path_.posix.extname(filePath);
		if (extension === '.js' || extension === '.jsx') {
			return 'js';
		}
		return 'ts';
	}
}

/**
 * Implementaton of LanguageServiceHost that works with in-memory file system.
 * It takes file content from local cache and provides it to TS compiler on demand
 *
 * @implements ts.LanguageServiceHost
 */
export class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {

	complete: boolean;

	/**
	 * Root path
	 */
	private rootPath: string;

	/**
	 * Compiler options to use when parsing/analyzing source files.
	 * We are extracting them from tsconfig.json or jsconfig.json
	 */
	private options: ts.CompilerOptions;

	/**
	 * Local file cache where we looking for file content
	 */
	private fs: InMemoryFileSystem;

	/**
	 * List of files that project consist of (based on tsconfig includes/excludes and wildcards).
	 * Each item is a relative file path
	 */
	expectedFilePaths: string[];

	/**
	 * Current list of files that were implicitly added to project
	 * (every time when we need to extract data from a file that we haven't touched yet).
	 * Each item is a relative file path
	 */
	private filePaths: string[];

	/**
	 * Current project version. When something significant is changed, incrementing it to signal TS compiler that
	 * files should be updated and cached data should be invalidated
	 */
	private projectVersion: number;

	/**
	 * Tracks individual files versions to invalidate TS compiler data when single file is changed. Keys are URIs
	 */
	private versions: Map<string, number>;

	constructor(private rootUri: URL, rootPath: string, options: ts.CompilerOptions, fs: InMemoryFileSystem, expectedFiles: string[], versions: Map<string, number>, private logger: Logger = new NoopLogger()) {
		this.rootPath = rootPath;
		this.options = options;
		this.fs = fs;
		this.expectedFilePaths = expectedFiles;
		this.versions = versions;
		this.projectVersion = 1;
		this.filePaths = [];
	}

	/**
	 * TypeScript uses this method (when present) to compare project's version
	 * with the last known one to decide if internal data should be synchronized
	 */
	getProjectVersion(): string {
		return '' + this.projectVersion;
	}

	/**
	 * Incrementing current project version, telling TS compiler to invalidate internal data
	 */
	incProjectVersion() {
		this.projectVersion++;
	}

	getCompilationSettings(): ts.CompilerOptions {
		return this.options;
	}

	getScriptFileNames(): string[] {
		return this.filePaths;
	}

	/**
	 * Adds a file and increments project version, used in conjunction with getProjectVersion()
	 * which may be called by TypeScript to check if internal data is up to date
	 *
	 * @param filePath relative file path
	 */
	addFile(filePath: string) {
		this.filePaths.push(filePath);
		this.incProjectVersion();
	}

	/**
	 * @param fileName Path to the file, absolute or relative to `rootUri`
	 */
	getScriptVersion(filePath: string): string {

		const uri = util.path2uri(this.rootUri, filePath);
		if (path_.posix.isAbsolute(filePath) || path_.isAbsolute(filePath)) {
			filePath = path_.posix.relative(this.rootPath, util.toUnixPath(filePath));
		}
		let version = this.versions.get(uri.href);
		if (!version) {
			version = 1;
			this.versions.set(uri.href, version);
		}
		return '' + version;
	}

	/**
	 * @param fileName Path to the file, absolute or relative to `rootUri`
	 */
	getScriptSnapshot(filePath: string): ts.IScriptSnapshot | undefined {
		const content = this.fs.readFileIfExists(filePath);
		if (content === undefined) {
			return undefined;
		}
		return ts.ScriptSnapshot.fromString(content);
	}

	getCurrentDirectory(): string {
		return this.rootPath;
	}

	getDefaultLibFileName(options: ts.CompilerOptions): string {
		return util.toUnixPath(ts.getDefaultLibFilePath(options));
	}

	trace(message: string) {
		// empty
	}

	log(message: string) {
		// empty
	}

	error(message: string) {
		this.logger.error(message);
	}

}

/**
 * ProjectConfiguration instances track the compiler configuration (as
 * defined by {tj}sconfig.json if it exists) and state for a single
 * TypeScript project. It represents the world of the view as
 * presented to the compiler.
 *
 * For efficiency, a ProjectConfiguration instance may hide some files
 * from the compiler, preventing them from being parsed and
 * type-checked. Depending on the use, the caller should call one of
 * the ensure* methods to ensure that the appropriate files have been
 * made available to the compiler before calling any other methods on
 * the ProjectConfiguration or its public members. By default, no
 * files are parsed.
 */
export class ProjectConfiguration {

	private service?: ts.LanguageService;

	// program is "a collection of SourceFiles and a set of
	// compilation options that represent a compilation unit. The
	// program is the main entry point to the type system and code
	// generation."
	// (https://github.com/Microsoft/TypeScript-wiki/blob/master/Architectural-Overview.md#data-structures)
	private program?: ts.Program;

	/**
	 * Object TS service will use to fetch content of source files
	 */
	private host?: InMemoryLanguageServiceHost;

	/**
	 * Local file cache
	 */
	private fs: InMemoryFileSystem;

	/**
	 * Relative path to configuration file (tsconfig.json/jsconfig.json)
	 */
	configFilePath: string;

	/**
	 * Configuration JSON object. May be used when there is no real configuration file to parse and use
	 */
	private configContent: any;

	/**
	 * Relative source file path (relative) -> version associations
	 */
	private versions: Map<string, number>;

	/**
	 * Enables module resolution tracing (done by TS service)
	 */
	private traceModuleResolution: boolean;

	/**
	 * Root file path, relative to workspace hierarchy root
	 */
	private rootFilePath: string;

	/**
	 * @param fs file system to use
	 * @param rootFilePath root file path, absolute
	 * @param configFilePath configuration file path, absolute
	 * @param configContent optional configuration content to use instead of reading configuration file)
	 */
	constructor(private rootUri: URL, fs: InMemoryFileSystem, rootFilePath: string, versions: Map<string, number>, configFilePath: string, configContent?: any, traceModuleResolution?: boolean, private logger: Logger = new NoopLogger()) {
		this.fs = fs;
		this.configFilePath = configFilePath;
		this.configContent = configContent;
		this.versions = versions;
		this.traceModuleResolution = traceModuleResolution || false;
		this.rootFilePath = rootFilePath;
	}

	/**
	 * @return module resolution host to use by TS service
	 */
	moduleResolutionHost(): ts.ModuleResolutionHost {
		return this.fs;
	}

	/**
	 * reset resets a ProjectConfiguration to its state immediately
	 * after construction. It should be called whenever the underlying
	 * local filesystem (fs) has changed, and so the
	 * ProjectConfiguration can no longer assume its state reflects
	 * that of the underlying files.
	 */
	reset(): void {
		this.initialized = false;
		this.ensuredBasicFiles = false;
		this.ensuredAllFiles = false;
		this.service = undefined;
		this.program = undefined;
		this.host = undefined;
	}

	/**
	 * @return package name (project name) of a given project
	 */
	getPackageName(): string | undefined {
		// package.json may be located at the upper level as well
		let currentDir = this.rootFilePath;
		while (true) {
			const pkgJsonFile = path_.posix.join(currentDir, 'package.json');
			if (this.fs.fileExists(pkgJsonFile)) {
				return JSON.parse(this.fs.readFile(pkgJsonFile)).name;
			}
			const parentDir = path_.posix.dirname(currentDir);
			if (parentDir === '.' || parentDir === currentDir || currentDir === this.fs.path) {
				return undefined;
			}
			currentDir = parentDir;
		}
	}

	/**
	 * @return language service object
	 */
	getService(): ts.LanguageService {
		if (!this.service) {
			throw new Error('project is uninitialized');
		}
		return this.service;
	}

	/**
	 * Note that it does not perform any parsing or typechecking
	 * @return program object (cached result of parsing and typechecking done by TS service)
	 */
	getProgram(): ts.Program | undefined {
		return this.program;
	}

	/**
	 * @return language service host that TS service uses to read the data
	 */
	getHost(): InMemoryLanguageServiceHost {
		if (!this.host) {
			throw new Error('project is uninitialized');
		}
		return this.host;
	}

	/**
	 * Tells TS service to recompile program (if needed) based on current list of files and compilation options.
	 * TS service relies on information provided by language servide host to see if there were any changes in
	 * the whole project or in some files
	 */
	syncProgram(childOf = new Span()): void {
		const span = childOf.tracer().startSpan('Sync program', { childOf });
		try {
			this.program = this.getService().getProgram();
		} catch (err) {
			span.setTag('error', true);
			span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
			this.logger.error(`Cannot create program object for ${this.rootFilePath}`, err);
		} finally {
			span.finish();
		}
	}

	private initialized = false;

	/**
	 * Initializes (sub)project by parsing configuration and making proper internal objects
	 */
	private init(span = new Span()): void {
		if (this.initialized) {
			return;
		}
		let configObject;
		if (!this.configContent) {
			const jsonConfig = ts.parseConfigFileTextToJson(this.configFilePath, this.fs.readFile(this.configFilePath));
			if (jsonConfig.error) {
				this.logger.error('Cannot parse ' + this.configFilePath + ': ' + jsonConfig.error.messageText);
				throw new Error('Cannot parse ' + this.configFilePath + ': ' + jsonConfig.error.messageText);
			}
			configObject = jsonConfig.config;
		} else {
			configObject = this.configContent;
		}
		let dir = util.toUnixPath(this.configFilePath);
		const pos = dir.lastIndexOf('/');
		if (pos <= 0) {
			dir = '';
		} else {
			dir = dir.substring(0, pos);
		}
		const base = dir || this.fs.path;
		const configParseResult = ts.parseJsonConfigFileContent(configObject, this.fs, base);
		const expFiles = configParseResult.fileNames;

		const options = configParseResult.options;
		if (/(^|\/)jsconfig\.json$/.test(this.configFilePath)) {
			options.allowJs = true;
		}
		if (this.traceModuleResolution) {
			options.traceResolution = true;
		}
		this.host = new InMemoryLanguageServiceHost(
			this.rootUri,
			this.fs.path,
			options,
			this.fs,
			expFiles,
			this.versions,
			this.logger
		);
		this.service = ts.createLanguageService(this.host, ts.createDocumentRegistry());
		this.syncProgram(span);
		this.initialized = true;
	}

	/**
	 * Ensures we are ready to process files from a given sub-project
	 */
	ensureConfigFile(span = new Span()): void {
		this.init(span);
	}

	private ensuredBasicFiles = false;

	/**
	 * Ensures we added basic files (global TS files, dependencies, declarations)
	 */
	ensureBasicFiles(span = new Span()): void {
		if (this.ensuredBasicFiles) {
			return;
		}

		this.init(span);

		const program = this.getProgram();
		if (!program) {
			return;
		}

		let changed = false;
		for (const uri of this.fs.uris()) {
			const fileName = util.uri2path(uri);
			if (util.isGlobalTSFile(fileName) || (!util.isDependencyFile(fileName) && util.isDeclarationFile(fileName))) {
				const sourceFile = program.getSourceFile(fileName);
				if (!sourceFile) {
					this.getHost().addFile(fileName);
					changed = true;
				}
			}
		}
		if (changed) {
			// requery program object to synchonize LanguageService's data
			this.syncProgram(span);
		}
		this.ensuredBasicFiles = true;
	}

	private ensuredAllFiles = false;

	/**
	 * Ensures we added all project's source file (as were defined in tsconfig.json)
	 */
	ensureAllFiles(span = new Span()): void {
		if (this.ensuredAllFiles) {
			return;
		}
		this.init(span);
		if (this.getHost().complete) {
			return;
		}
		const program = this.getProgram();
		if (!program) {
			return;
		}
		let changed = false;
		for (const fileName of (this.getHost().expectedFilePaths || [])) {
			const sourceFile = program.getSourceFile(fileName);
			if (!sourceFile) {
				this.getHost().addFile(fileName);
				changed = true;
			}
		}
		if (changed) {
			// requery program object to synchonize LanguageService's data
			this.syncProgram(span);
		}
		this.getHost().complete = true;
		this.ensuredAllFiles = true;
	}
}
