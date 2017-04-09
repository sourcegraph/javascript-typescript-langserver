import { Observable } from '@reactivex/rxjs';
import iterate from 'iterare';
import { memoize } from 'lodash';
import { Span } from 'opentracing';
import * as os from 'os';
import * as path_ from 'path';
import * as ts from 'typescript';
import * as url from 'url';
import { Disposable } from 'vscode-languageserver';
import { CancellationToken, CancellationTokenSource, throwIfCancelledError, throwIfRequested } from './cancellation';
import { FileSystemUpdater } from './fs';
import { Logger, NoopLogger } from './logging';
import { InMemoryFileSystem, walkInMemoryFs } from './memfs';
import * as util from './util';

/**
 * ProjectManager translates VFS files to one or many projects denoted by [tj]config.json.
 * It uses either local or remote file system to fetch directory tree and files from and then
 * makes one or more LanguageService objects. By default all LanguageService objects contain no files,
 * they are added on demand - current file for hover or definition, project's files for references and
 * all files from all projects for workspace symbols.
 */
export class ProjectManager implements Disposable {

	/**
	 * Cancellations to do when the object is disposed
	 */
	private cancellationSources = new Set<CancellationTokenSource>();

	/**
	 * Root path (as passed to `initialize` request)
	 */
	private rootPath: string;

	/**
	 * Workspace subtree (folder) -> JS/TS configuration mapping.
	 * Configuration settings for a source file A are located in the closest parent folder of A.
	 * Map keys are relative (to workspace root) paths
	 */
	private configs: Map<string, ProjectConfiguration>;

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
	 * Relative file path -> version map. Every time file content is about to change or changed (didChange/didOpen/...), we are incrementing it's version
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
	 * For references/symbols we need all the source files making workspace so this flag tracks if we already did it
	 */
	private ensuredAllFiles?: Promise<void>;

	/**
	 * A URI Map from file to files referenced by the file, so files only need to be pre-processed once
	 */
	private referencedFiles = new Map<string, Observable<string>>();

	/**
	 * @param rootPath root path as passed to `initialize`
	 * @param inMemoryFileSystem File system that keeps structure and contents in memory
	 * @param strict indicates if we are working in strict mode (VFS) or with a local file system
	 * @param traceModuleResolution allows to enable module resolution tracing (done by TS compiler)
	 */
	constructor(rootPath: string, inMemoryFileSystem: InMemoryFileSystem, updater: FileSystemUpdater, strict: boolean, traceModuleResolution?: boolean, protected logger: Logger = new NoopLogger()) {
		this.rootPath = util.toUnixPath(rootPath);
		this.configs = new Map<string, ProjectConfiguration>();
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
		for (const source of this.cancellationSources) {
			source.cancel();
		}
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
		return this.configs.values();
	}

	/**
	 * Ensures that the module structure of the project exists in memory.
	 * TypeScript/JavaScript module structure is determined by [jt]sconfig.json,
	 * filesystem layout, global*.d.ts and package.json files.
	 * Then creates new ProjectConfigurations, resets existing and invalidates file references.
	 */
	ensureModuleStructure(): Promise<void> {
		if (this.ensuredModuleStructure) {
			return this.ensuredModuleStructure;
		}
		this.ensuredModuleStructure = (async () => {
			await this.updater.ensureStructure();
			// Ensure content of all all global .d.ts, [tj]sconfig.json, package.json files
			await Promise.all(
				iterate(this.localFs.uris())
					.filter(uri => util.isGlobalTSFile(uri) || util.isConfigFile(uri) || util.isPackageJsonFile(uri))
					.map(uri => this.updater.ensure(uri))
			);
			// Scan for [tj]sconfig.json files
			this.createConfigurations();
			// Reset all compilation state
			// TODO utilize incremental compilation instead
			for (const config of this.configs.values()) {
				config.reset();
			}
			// Require re-processing of file references
			this.invalidateReferencedFiles();
		})();
		return this.ensuredModuleStructure;
	}

	/**
	 * Causes the next call of `ensureModuleStructure` to re-ensure module structure
	 */
	invalidateModuleStructure(): void {
		this.ensuredModuleStructure = undefined;
	}

	/**
	 * Ensures all files needed for a workspace/symbol request are available in memory.
	 * This includes all js/ts files, tsconfig files and package.json files.
	 * It excludes files in node_modules.
	 * Invalidates project configurations after execution
	 */
	ensureFilesForWorkspaceSymbol = memoize(async (): Promise<void> => {
		try {
			await this.updater.ensureStructure();
			const filesToEnsure = [];
			for (const uri of this.localFs.uris()) {
				const file = util.uri2path(uri);
				if (
					util.toUnixPath(file).indexOf('/node_modules/') === -1
					&& (util.isJSTSFile(file) || util.isConfigFile(file) || util.isPackageJsonFile(file))
				) {
					filesToEnsure.push(file);
				}
			}
			await this.ensureFiles(filesToEnsure);
			await this.createConfigurations();
		} catch (e) {
			this.ensureFilesForWorkspaceSymbol.cache = new WeakMap();
			throw e;
		}
	});

	/**
	 * Ensures all files were fetched from the remote file system.
	 * Invalidates project configurations after execution
	 */
	ensureAllFiles(): Promise<void> {
		if (this.ensuredAllFiles) {
			return this.ensuredAllFiles;
		}

		const promise = this.updater.ensureStructure()
			.then(() => this.ensureFiles(
				iterate(this.localFs.uris())
					.map(uri => util.uri2path(uri))
					.filter(file => util.isJSTSFile(file))
			))
			.then(() => this.createConfigurations());

		this.ensuredAllFiles = promise;
		promise.catch(err => {
			this.logger.error('Failed to fetch files for references:', err);
			this.ensuredAllFiles = undefined;
		});

		return promise;
	}

	/**
	 * Ensures that we have all the files needed to retrieve all the references to a symbol in the given file.
	 * Pretty much it's the same set of files needed to produce workspace symbols unless file is located in `node_modules`
	 * in which case we need to fetch the whole tree
	 *
	 * @param uri target file URI
	 */
	ensureFilesForReferences(uri: string): Promise<void> {
		const fileName: string = util.uri2path(uri);
		if (util.toUnixPath(fileName).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
			return this.ensureFilesForWorkspaceSymbol();
		}

		return this.ensureAllFiles();
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
	ensureReferencedFiles(uri: string, maxDepth = 30, ignore = new Set<string>(), childOf = new Span()): Observable<string> {
		const span = childOf.tracer().startSpan('Ensure referenced files', { childOf });
		span.addTags({ uri, maxDepth });
		ignore.add(uri);
		return Observable.from(this.ensureModuleStructure())
			// If max depth was reached, don't go any further
			.mergeMap(() => maxDepth === 0 ? [] : this.resolveReferencedFiles(uri))
			// Prevent cycles
			.filter(referencedUri => !ignore.has(referencedUri))
			// Call method recursively with one less dep level
			// Don't pass span, because the recursive call would create way to many spans
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
				span.log({ 'event': 'error', 'error.object': err });
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
	 * @param span OpenTracing span to pass to child operations
	 * @return URIs of files referenced by the file
	 */
	private resolveReferencedFiles(uri: string, span = new Span()): Observable<string> {
		let observable = this.referencedFiles.get(uri);
		if (observable) {
			return observable;
		}
		const parts = url.parse(uri);
		if (!parts.pathname) {
			return Observable.throw(new Error(`Invalid URI ${uri}`));
		}
		// TypeScript works with file paths, not URIs
		const filePath = parts.pathname.split('/').map(decodeURIComponent).join('/');
		observable = Observable.from(this.updater.ensure(uri, span))
			.mergeMap(() => {
				const config = this.getConfiguration(filePath);
				config.ensureBasicFiles();
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
						.map(referencedFile => util.toUnixPath(
							path_.relative(
								this.rootPath,
								resolver.resolve(
									this.rootPath,
									resolver.dirname(filePath),
									util.toUnixPath(referencedFile.fileName)
								)
							)
						))
				);
			})
			// Use same scheme, slashes, host for referenced URI as input file
			.map(filePath => url.format({ ...parts, pathname: filePath.split(/[\\\/]/).map(encodeURIComponent).join('/'), search: undefined, hash: undefined }))
			// Don't cache errors
			.catch(err => {
				this.referencedFiles.delete(uri);
				throw err;
			})
			// Make sure all subscribers get the same values
			.publishReplay()
			.refCount();
		this.referencedFiles.set(uri, observable);
		return observable;
	}

	/**
	 * @param filePath source file path relative to project root
	 * @return project configuration for a given source file. Climbs directory tree up to workspace root if needed
	 */
	getConfiguration(filePath: string): ProjectConfiguration {
		let dir = filePath;
		let config;
		while (dir && dir !== this.rootPath) {
			config = this.configs.get(dir);
			if (config) {
				return config;
			}
			dir = path_.posix.dirname(dir);
			if (dir === '.') {
				dir = '';
			}
		}
		config = this.configs.get('');
		if (config) {
			return config;
		}
		throw new Error(`TypeScript config file for ${filePath} not found`);
	}

	/**
	 * Called when file was opened by client. Current implementation
	 * does not differenciates open and change events
	 * @param filePath path to a file relative to project root
	 * @param text file's content
	 */
	didOpen(filePath: string, text: string) {
		this.didChange(filePath, text);
	}

	/**
	 * Called when file was closed by client. Current implementation invalidates compiled version
	 * @param filePath path to a file relative to project root
	 */
	didClose(filePath: string) {
		this.localFs.didClose(filePath);
		let version = this.versions.get(filePath) || 0;
		this.versions.set(filePath, ++version);
		const config = this.getConfiguration(filePath);
		config.ensureConfigFile();
		config.getHost().incProjectVersion();
		config.syncProgram();
	}

	/**
	 * Called when file was changed by client. Current implementation invalidates compiled version
	 * @param filePath path to a file relative to project root
	 * @param text file's content
	 */
	didChange(filePath: string, text: string) {
		this.localFs.didChange(filePath, text);
		let version = this.versions.get(filePath) || 0;
		this.versions.set(filePath, ++version);
		const config = this.getConfiguration(filePath);
		config.ensureConfigFile();
		config.getHost().incProjectVersion();
		config.syncProgram();
	}

	/**
	 * Called when file was saved by client
	 * @param filePath path to a file relative to project root
	 */
	didSave(filePath: string) {
		this.localFs.didSave(filePath);
	}

	/**
	 * ensureFiles ensures the following files have been fetched to
	 * localFs. The files parameter is expected to contain paths in
	 * the remote FS. ensureFiles only syncs unfetched file content
	 * from remoteFs to localFs. It does not update project
	 * state. Callers that want to do so after file contents have been
	 * fetched should call this.createConfigurations().
	 *
	 * If one file fetch failed, the error will be caught and logged.
	 *
	 * @param files File paths
	 */
	async ensureFiles(files: Iterable<string>, token: CancellationToken = CancellationToken.None): Promise<void> {
		const source = new CancellationTokenSource();
		token.onCancellationRequested(() => source.cancel());
		this.cancellationSources.add(source);
		token = source.token;
		try {
			await Promise.all(iterate(files).map(async path => {
				throwIfRequested(token);
				try {
					await this.updater.ensure(util.path2uri('', path));
				} catch (err) {
					// if cancellation was requested, break out of the loop
					throwIfCancelledError(err);
					throwIfRequested(token);
					// else log error and continue
					this.logger.error(`Ensuring file ${path} failed`, err);
				}
			}));
		} finally {
			this.cancellationSources.delete(source);
		}
	}

	/**
	 * Detects projects and creates projects denoted by tsconfig.json and jsconfig.json fiels.
	 * Previously detected projects are NOT discarded.
	 * If there is no root configuration, adds it to catch all orphan files
	 */
	createConfigurations() {
		const rootdirs = new Set<string>();
		for (const uri of this.localFs.uris()) {
			const relativeFilePath = path_.posix.relative(this.rootPath, util.uri2path(uri));
			if (!/(^|\/)[tj]sconfig\.json$/.test(relativeFilePath)) {
				continue;
			}
			if (/(^|\/)node_modules\//.test(relativeFilePath)) {
				continue;
			}
			let dir = path_.posix.dirname(relativeFilePath);
			if (dir === '.') {
				dir = '';
			}
			if (!this.configs.has(dir)) {
				this.configs.set(dir, new ProjectConfiguration(this.localFs, path_.posix.join('/', dir), this.versions, relativeFilePath, undefined, this.traceModuleResolution, this.logger));
			}
			rootdirs.add(dir);
		}
		if (!rootdirs.has('') && !this.configs.has('')) {
			// collecting all the files in workspace by making fake configuration object
			this.configs.set('', new ProjectConfiguration(this.localFs, '/', this.versions, '', {
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					allowNonTsExtensions: false,
					allowJs: true
				}
			}, this.traceModuleResolution, this.logger));
		}
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
	 * Tracks individual files versions to invalidate TS compiler data when single file is changed
	 */
	private versions: Map<string, number>;

	constructor(rootPath: string, options: ts.CompilerOptions, fs: InMemoryFileSystem, expectedFiles: string[], versions: Map<string, number>, private logger: Logger = new NoopLogger()) {
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
	 * @param fileName relative or absolute file path
	 */
	getScriptVersion(fileName: string): string {
		if (path_.posix.isAbsolute(fileName) || path_.isAbsolute(fileName)) {
			fileName = path_.posix.relative(this.rootPath, util.toUnixPath(fileName));
		}
		let version = this.versions.get(fileName);
		if (!version) {
			version = 1;
			this.versions.set(fileName, version);
		}
		return '' + version;
	}

	/**
	 * @param fileName relative or absolute file path
	 */
	getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
		let exists = this.fs.fileExists(fileName);
		if (!exists) {
			fileName = path_.posix.join(this.rootPath, fileName);
			exists = this.fs.fileExists(fileName);
		}
		if (!exists) {
			return undefined;
		}
		return ts.ScriptSnapshot.fromString(this.fs.readFile(fileName));
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
	private configFilePath: string;

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
	 * @param rootFilePath root file path, relative to workspace hierarchy root
	 * @param configFilePath configuration file path (relative to workspace root)
	 * @param configContent optional configuration content to use instead of reading configuration file)
	 */
	constructor(fs: InMemoryFileSystem, rootFilePath: string, versions: Map<string, number>, configFilePath: string, configContent?: any, traceModuleResolution?: boolean, private logger: Logger = new NoopLogger()) {
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
	getPackageName(): string | null {
		// package.json may be located at the upper level as well
		let currentDir = this.rootFilePath;
		while (true) {
			const pkgJsonFile = path_.posix.join(currentDir, 'package.json');
			if (this.fs.fileExists(pkgJsonFile)) {
				return JSON.parse(this.fs.readFile(pkgJsonFile)).name;
			}
			const parentDir = path_.dirname(currentDir);
			if (parentDir === '.' || parentDir === '/' || parentDir === currentDir) {
				return null;
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
	getProgram(): ts.Program {
		if (!this.program) {
			throw new Error('project is uninitialized');
		}
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
	syncProgram(): void {
		this.program = this.getService().getProgram();
	}

	private initialized = false;

	/**
	 * Initializes (sub)project by parsing configuration and making proper internal objects
	 */
	private init(): void {
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
		let dir = path_.posix.dirname(this.configFilePath);
		if (dir === '.') {
			dir = '';
		}
		const base = dir || this.fs.path;
		const configParseResult = ts.parseJsonConfigFileContent(configObject, this.fs, base);
		const expFiles = configParseResult.fileNames;

		// Add globals that might exist in dependencies
		const nodeModulesDir = path_.posix.join(base, 'node_modules');
		const err = walkInMemoryFs(this.fs, nodeModulesDir, (path, isdir) => {
			if (!isdir && util.isGlobalTSFile(path)) {
				expFiles.push(path);
			}
		});
		if (err) {
			throw err;
		}

		const options = configParseResult.options;
		if (/(^|\/)jsconfig\.json$/.test(this.configFilePath)) {
			options.allowJs = true;
		}
		if (this.traceModuleResolution) {
			options.traceResolution = true;
		}
		this.host = new InMemoryLanguageServiceHost(
			this.fs.path,
			options,
			this.fs,
			expFiles,
			this.versions,
			this.logger
		);
		this.service = ts.createLanguageService(this.host, ts.createDocumentRegistry());
		this.program = this.service.getProgram();
		this.initialized = true;
	}

	/**
	 * Ensures we are ready to process files from a given sub-project
	 */
	ensureConfigFile(): void {
		this.init();
	}

	private ensuredBasicFiles = false;

	/**
	 * Ensures we added basic files (global TS files, dependencies, declarations)
	 */
	ensureBasicFiles(): void {
		if (this.ensuredBasicFiles) {
			return;
		}

		this.init();
		let changed = false;
		for (const fileName of (this.getHost().expectedFilePaths || [])) {
			if (util.isGlobalTSFile(fileName) || (!util.isDependencyFile(fileName) && util.isDeclarationFile(fileName))) {
				const sourceFile = this.getProgram().getSourceFile(fileName);
				if (!sourceFile) {
					this.getHost().addFile(fileName);
					changed = true;
				}
			}
		}
		if (changed) {
			// requery program object to synchonize LanguageService's data
			this.program = this.getService().getProgram();
		}
		this.ensuredBasicFiles = true;
	}

	private ensuredAllFiles = false;

	/**
	 * Ensures we added all project's source file (as were defined in tsconfig.json)
	 */
	ensureAllFiles(): void {
		if (this.ensuredAllFiles) {
			return;
		}

		this.init();
		if (this.getHost().complete) {
			return;
		}
		let changed = false;
		for (const fileName of (this.getHost().expectedFilePaths || [])) {
			const sourceFile = this.getProgram().getSourceFile(fileName);
			if (!sourceFile) {
				this.getHost().addFile(fileName);
				changed = true;
			}
		}
		if (changed) {
			// requery program object to synchonize LanguageService's data
			this.program = this.getService().getProgram();
		}
		this.getHost().complete = true;
		this.ensuredAllFiles = true;
	}
}
