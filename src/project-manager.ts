import * as fs_ from 'fs';
import * as os from 'os';
import * as path_ from 'path';

import * as ts from 'typescript';

import * as bluebird from 'bluebird';
import { memoize } from 'lodash';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';
import { Disposable } from 'vscode-languageserver';
import { throwIfRequested } from './cancellation';
import * as FileSystem from './fs';
import * as match from './match-files';
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
	 * Remote side of file content provider which may point to either a client (strict mode) or
	 * to a local file system
	 */
	private remoteFs: FileSystem.FileSystem;

	/**
	 * Local side of file content provider which keeps cache of fetched files
	 */
	private localFs: InMemoryFileSystem;

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
	 * fetched keeps track of which files in localFs have actually
	 * been fetched from remoteFs. (Some might have a placeholder
	 * value). If a file has already been successfully fetched, we
	 * won't fetch it again. This should be cleared if remoteFs files
	 * have been modified in some way, but does not need to be cleared
	 * if remoteFs files have only been added.
	 *
	 * Set elements are absolute file paths
	 */
	private fetched: Set<string>;

	/**
	 * Flag indicating that we fetched module struture (tsconfig.json, jsconfig.json, package.json files) from the remote file system.
	 * Without having this information we won't be able to split workspace to sub-projects
	 */
	private ensuredModuleStructure?: Promise<void>;

	/**
	 * Tracks if source file denoted by the given URI is fetched from remote file system and available locally.
	 * For hover or definition we only need a single file (and maybe its transitive includes/references as reported by TS compiler).
	 * This map prevents fetching of file content from remote filesystem twice
	 */
	private ensuredFilesForHoverAndDefinition = new Map<string, Promise<void>>();

	/**
	 * For references/symbols we need all the source files making workspace so this flag tracks if we already did it
	 */
	private ensuredAllFiles?: Promise<void>;

	/**
	 * @param rootPath root path as passed to `initialize`
	 * @param remoteFS remote side of file content provider, used to fetch content from on demand
	 * @param strict indicates if we are working in strict mode (VFS) or with a local file system
	 * @param traceModuleResolution allows to enable module resolution tracing (done by TS compiler)
	 */
	constructor(rootPath: string, remoteFs: FileSystem.FileSystem, strict: boolean, traceModuleResolution?: boolean) {
		this.rootPath = util.normalizePath(rootPath);
		this.configs = new Map<string, ProjectConfiguration>();
		this.localFs = new InMemoryFileSystem(this.rootPath);
		this.versions = new Map<string, number>();
		this.fetched = new Set<string>();
		this.remoteFs = remoteFs;
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
	getConfigurations(): ProjectConfiguration[] {
		const ret: ProjectConfiguration[] = [];
		this.configs.forEach((v, k) => {
			ret.push(v);
		});
		return ret;
	}

	/**
	 * ensureModuleStructure ensures that the module structure of the
	 * project exists in localFs. TypeScript/JavaScript module
	 * structure is determined by [jt]sconfig.json, filesystem layout,
	 * global*.d.ts files. For performance reasons, we only read in
	 * the contents of some files and store "var dummy_0ff1bd;" as the
	 * contents of all other files.
	 */
	ensureModuleStructure(): Promise<void> {
		if (!this.ensuredModuleStructure) {
			this.ensuredModuleStructure = this.refreshFileTree(this.rootPath, true).then(() => {
				this.refreshConfigurations();
			});
			this.ensuredModuleStructure.catch(err => {
				console.error('Failed to fetch module structure:', err);
				this.ensuredModuleStructure = undefined;
			});
		}
		return this.ensuredModuleStructure;
	}

	/**
	 * refreshFileTree refreshes the local in-memory filesytem's (this.localFs) files under the
	 * specified path (root) with the contents of the remote filesystem (this.remoteFs). It will
	 * also reset the ProjectConfigurations that are affected by the refreshed files.
	 *
	 * If moduleStructureOnly is true, then only files related to module structure (package.json,
	 * tsconfig.json, etc.) will be refreshed.
	 *
	 * This method is public because a ProjectManager instance assumes there are no changes made to
	 * the remote filesystem structure after initialization. If such changes are made, it is
	 * necessary to call this method to alert the ProjectManager instance of the change.
	 *
	 * @param rootPath root path
	 * @param moduleStructureOnly indicates if we need to fetch only configuration files such as tsconfig.json,
	 * jsconfig.json or package.json (otherwise we want to fetch them plus source files)
	 */
	async refreshFileTree(rootPath: string, moduleStructureOnly: boolean): Promise<void> {
		rootPath = util.normalizeDir(rootPath);
		const filesToFetch: string[] = [];
		const uris = await this.remoteFs.getWorkspaceFiles(util.path2uri('', rootPath));
		for (const uri of uris) {
			const file = util.uri2path(uri);
			const rel = path_.posix.relative(this.rootPath, util.normalizePath(file));
			if (!moduleStructureOnly || util.isGlobalTSFile(rel) || util.isConfigFile(rel) || util.isPackageJsonFile(rel)) {
				filesToFetch.push(file);
			} else if (!this.localFs.fileExists(rel)) {
				this.localFs.addFile(rel, localFSPlaceholder);
			}
		}
		await this.ensureFiles(filesToFetch);

		// require re-fetching of dependency files (but not for
		// workspace/symbol and textDocument/references, because those
		// should not be affected by new external modules)
		this.ensuredFilesForHoverAndDefinition.clear();

		// require re-parsing of projects whose file set may have been affected
		for (let [dir, config] of this.configs) {
			dir = util.normalizeDir(dir);

			if (dir.startsWith(rootPath + '/') || rootPath.startsWith(dir + '/') || rootPath === dir) {
				config.reset();
			}
		}
	}

	/**
	 * Ensures that all the files needed to produce hover and definitions for a given
	 * source file URI were fetched from the remote file system. Set of the needed files includes:
	 * - file itself
	 * - file's includes and dependencies (transitive) reported by TS compiler up to depth 30
	 * There is no need to fetch/parse/compile all the workspace files to produce hover of a symbol in the file F because
	 * definition of this symbol must be in one of files references by F or its dependencies
	 *
	 * @param uri target file URI
	 */
	ensureFilesForHoverAndDefinition(uri: string): Promise<void> {
		const existing = this.ensuredFilesForHoverAndDefinition.get(uri);
		if (existing) {
			return existing;
		}

		const promise = this.ensureModuleStructure().then(() => {
			// include dependencies up to depth 30
			const deps = new Set<string>();
			return this.ensureTransitiveFileDependencies([util.uri2path(uri)], 30, deps).then(() => {
				return this.refreshConfigurations();
			});
		});
		this.ensuredFilesForHoverAndDefinition.set(uri, promise);
		promise.catch(err => {
			console.error('Failed to fetch files for hover/definition for uri ', uri, ', error:', err);
			this.ensuredFilesForHoverAndDefinition.delete(uri);
		});
		return promise;
	}

	/**
	 * Ensures all files needed for a workspace/symbol request are available in memory.
	 * This includes all js/ts files, tsconfig files and package.json files.
	 * It excludes files in node_modules.
	 * Invalidates project configurations after execution
	 */
	ensureFilesForWorkspaceSymbol = memoize(async (): Promise<void> => {
		try {
			const uris = await this.remoteFs.getWorkspaceFiles(util.path2uri('', this.getRemoteRoot()));
			const filesToEnsure = [];
			for (const uri of uris) {
				const file = util.uri2path(uri);
				if (
					util.normalizePath(file).indexOf('/node_modules/') === -1
					&& (util.isJSTSFile(file) || util.isConfigFile(file) || util.isPackageJsonFile(file))
				) {
					filesToEnsure.push(file);
				}
			}
			await this.ensureFiles(filesToEnsure);
			await this.refreshConfigurations();
		} catch (e) {
			(this.ensureFilesForWorkspaceSymbol.cache as Map<undefined, Promise<void>>).clear();
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

		const promise = this.remoteFs.getWorkspaceFiles(util.path2uri('', this.getRemoteRoot()))
			.then(uris => this.ensureFiles(
				uris
					.map(uri => util.uri2path(uri))
					.filter(file => util.isJSTSFile(file))
			))
			.then(() => this.refreshConfigurations());

		this.ensuredAllFiles = promise;
		promise.catch(err => {
			console.error('Failed to fetch files for references:', err);
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
		if (util.normalizePath(fileName).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
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
	 * @param filePaths files to process (both absolute and relative paths are accepted)
	 * @param maxDepth stop collecting when reached given recursion level
	 * @param seen tracks visited files to avoid cycles
	 */
	private async ensureTransitiveFileDependencies(filePaths: string[], maxDepth: number, seen: Set<string>): Promise<void> {
		filePaths = filePaths.filter(f => !seen.has(f));
		if (filePaths.length === 0) {
			return Promise.resolve();
		}
		filePaths.forEach(f => seen.add(f));

		const absFilePaths = filePaths.map(f => util.normalizePath(util.resolve(this.rootPath, f)));
		await this.ensureFiles(absFilePaths);

		if (maxDepth > 0) {
			const importPaths = new Set<string>();
			await Promise.all(filePaths.map(async filePath => {
				const config = this.getConfiguration(filePath);
				await config.ensureBasicFiles();
				const contents = this.getFs().readFile(filePath) || '';
				const info = ts.preProcessFile(contents, true, true);
				const compilerOpt = config.getHost().getCompilationSettings();
				for (const imp of info.importedFiles) {
					const resolved = ts.resolveModuleName(imp.fileName, filePath, compilerOpt, config.moduleResolutionHost());
					if (!resolved || !resolved.resolvedModule) {
						// This means we didn't find a file defining
						// the module. It could still exist as an
						// ambient module, which is why we fetch
						// global*.d.ts files.
						continue;
					}
					importPaths.add(resolved.resolvedModule.resolvedFileName);
				}
				const resolver = !this.strict && os.platform() === 'win32' ? path_ : path_.posix;
				for (const ref of info.referencedFiles) {
					// Resolving triple slash references relative to current file
					// instead of using module resolution host because it behaves
					// differently in "nodejs" mode
					const refFilePath = util.normalizePath(path_.relative(this.rootPath,
						resolver.resolve(this.rootPath,
							resolver.dirname(filePath),
							ref.fileName)));
					importPaths.add(refFilePath);
				}
			}));
			await this.ensureTransitiveFileDependencies(Array.from(importPaths), maxDepth - 1, seen);
		}
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
		throw new Error('unreachable');
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
		config.ensureConfigFile().then(() => {
			config.getHost().incProjectVersion();
			config.syncProgram();
		});
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
		config.ensureConfigFile().then(() => {
			config.getHost().incProjectVersion();
			config.syncProgram();
		});
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
	 * fetched should call this.refreshConfigurations().
	 *
	 * If one file fetch failed, the error will be caught and logged.
	 *
	 * @param files File paths
	 */
	async ensureFiles(files: string[], token: CancellationToken = CancellationToken.None): Promise<void> {
		const source = new CancellationTokenSource();
		token.onCancellationRequested(() => source.cancel());
		this.cancellationSources.add(source);
		token = source.token;
		try {
			await bluebird.map(files, async path => {
				throwIfRequested(token);
				// Only fetch files that are not already fetched
				if (this.fetched.has(path)) {
					return;
				}
				try {
					const content = await this.remoteFs.getTextDocumentContent(util.path2uri('', path), token);
					const relativePath = path_.posix.relative(this.rootPath, path);
					this.localFs.addFile(relativePath, content);
					this.fetched.add(util.normalizePath(path));
				} catch (e) {
					// if cancellation was requested, break out of the loop
					throwIfRequested(token);
					// else log error and continue
					console.error(`Ensuring file ${path} failed`, e);
				}
			}, {
				// There may be too many open files when working with local FS and trying
				// to open them in parallel, so limit concurrent readFile calls to 100
				// TODO only do this when working with localFs?
				concurrency: 100
			});
		} finally {
			this.cancellationSources.delete(source);
		}
	}

	/**
	 * Detects projects and creates projects denoted by tsconfig.json. Previously detected projects are discarded.
	 * If there is no root configuration, adds it to catch all orphan files
	 */
	refreshConfigurations() {
		const rootdirs = new Set<string>();
		this.localFs.entries.forEach((v, k) => {
			if (!/(^|\/)[tj]sconfig\.json$/.test(k)) {
				return;
			}
			if (/(^|\/)node_modules\//.test(k)) {
				return;
			}
			let dir = path_.posix.dirname(k);
			if (dir === '.') {
				dir = '';
			}
			this.configs.set(dir, new ProjectConfiguration(this.localFs, path_.posix.join('/', dir), this.versions, k, undefined, this.traceModuleResolution));
			rootdirs.add(dir);
		});
		if (!rootdirs.has('')) {
			// collecting all the files in workspace by making fake configuration object
			this.configs.set('', new ProjectConfiguration(this.localFs, '/', this.versions, '', {
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					allowNonTsExtensions: false,
					allowJs: true
				}
			}, this.traceModuleResolution));
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

	constructor(rootPath: string, options: ts.CompilerOptions, fs: InMemoryFileSystem, expectedFiles: string[], versions: Map<string, number>) {
		this.rootPath = rootPath;
		this.options = options;
		this.fs = fs;
		this.expectedFilePaths = expectedFiles;
		this.versions = versions;
		this.projectVersion = 1;
		this.filePaths = [];
		// adding library files from the local file system
		getTypeScriptLibraries().forEach((content, name) => {
			this.fs.entries.set(name, content);
		});
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
			fileName = path_.posix.relative(this.rootPath, util.normalizePath(fileName));
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
	getScriptSnapshot(fileName: string): ts.IScriptSnapshot {
		let entry = this.fs.readFile(fileName);
		if (entry === undefined) {
			fileName = path_.posix.join(this.rootPath, fileName);
			entry = this.fs.readFile(fileName);
		}
		if (entry === undefined) {
			return undefined;
		}
		return ts.ScriptSnapshot.fromString(entry);
	}

	getCurrentDirectory(): string {
		return this.rootPath;
	}

	getDefaultLibFileName(options: ts.CompilerOptions): string {
		return util.normalizePath(ts.getDefaultLibFilePath(options));
	}

	trace(message: string) {
		// empty
	}

	log(message: string) {
		// empty
	}

	error(message: string) {
		console.error(message);
	}

}

const localFSPlaceholder = 'var dummy_0ff1bd;';

/**
 * In-memory file cache node which represents either a folder or a file
 */
export interface FileSystemNode {
	file: boolean;
	children: Map<string, FileSystemNode>;
};

/**
 * In-memory file system, can be served as a ParseConfigHost (thus allowing listing files that belong to project based on tsconfig.json options)
 */
export class InMemoryFileSystem implements ts.ParseConfigHost, ts.ModuleResolutionHost {

	/**
	 * Map (relative filepath -> string content) of files fetched from the remote file system. Paths are relative to `this.path`
	 */
	entries: Map<string, string>;

	/**
	 * Map (relative filepath -> string content) of temporary files made while user modifies local file(s).  Paths are relative to `this.path`
	 */
	overlay: Map<string, string>;

	/**
	 * Should we take into account register when performing a file name match or not. On Windows when using local file system, file names are case-insensitive
	 */
	useCaseSensitiveFileNames: boolean;

	/**
	 * Root path
	 */
	path: string;

	/**
	 * File tree root
	 */
	rootNode: FileSystemNode;

	constructor(path: string) {
		this.path = path;
		this.entries = new Map<string, string>();
		this.overlay = new Map<string, string>();
		this.rootNode = { file: false, children: new Map<string, FileSystemNode>() };
	}

	/**
	 * Adds file content to a local cache
	 * @param path relative file path
	 * @param content file content
	 */
	addFile(path: string, content: string) {
		this.entries.set(path, content);
		let node = this.rootNode;
		path.split('/').forEach((component, i, components) => {
			const n = node.children.get(component);
			if (!n) {
				if (i < components.length - 1) {
					const n = { file: false, children: new Map<string, FileSystemNode>() };
					node.children.set(component, n);
					node = n;
				} else {
					node.children.set(component, { file: true, children: new Map<string, FileSystemNode>() });
				}
			} else {
				node = n;
			}
		});
	}

	/**
	 * Tells if a file denoted by the given name exists in the local cache
	 * @param path file path (both absolute or relative file paths are accepted)
	 */
	fileExists(path: string): boolean {
		return this.readFile(path) !== undefined;
	}

	/**
	 * @param path file path (both absolute or relative file paths are accepted)
	 * @return file's content in the following order (overlay then cache) if any
	 */
	readFile(path: string): string | undefined {
		let content = this.overlay.get(path);
		if (content !== undefined) {
			return content;
		}

		const rel = path_.posix.relative('/', path);
		content = this.overlay.get(rel);
		if (content !== undefined) {
			return content;
		}

		content = this.entries.get(path);
		if (content !== undefined) {
			return content;
		}

		return this.entries.get(rel);
	}

	/**
	 * Invalidates temporary content denoted by the given path
	 * @param path path to a file relative to project root
	 */
	didClose(path: string) {
		this.overlay.delete(path);
	}

	/**
	 * Adds temporary content denoted by the given path
	 * @param path path to a file relative to project root
	 */
	didSave(path: string) {
		this.addFile(path, this.readFile(path));
	}

	/**
	 * Updates temporary content denoted by the given path
	 * @param path path to a file relative to project root
	 */
	didChange(path: string, text: string) {
		this.overlay.set(path, text);
	}

	/**
	 * Called by TS service to scan virtual directory when TS service looks for source files that belong to a project
	 */
	readDirectory(rootDir: string, extensions: string[], excludes: string[], includes: string[]): string[] {
		return match.matchFiles(rootDir,
			extensions,
			excludes,
			includes,
			true,
			this.path,
			p => this.getFileSystemEntries(p));
	}

	/**
	 * Called by TS service to scan virtual directory when TS service looks for source files that belong to a project
	 */
	getFileSystemEntries(path: string): match.FileSystemEntries {
		const ret: { files: string[], directories: string[] } = { files: [], directories: [] };
		let node = this.rootNode;
		const components = path.split('/').filter(c => c);
		if (components.length !== 1 || components[0]) {
			for (const component of components) {
				const n = node.children.get(component);
				if (!n) {
					return ret;
				}
				node = n;
			}
		}
		node.children.forEach((value, name) => {
			if (value.file) {
				ret.files.push(name);
			} else {
				ret.directories.push(name);
			}
		});
		return ret;
	}

	trace(message: string) {
		console.error(message);
	}
}

/**
 * Iterates over in-memory cache calling given function on each node until callback signals abort or all nodes were traversed
 */
export function walkInMemoryFs(fs: InMemoryFileSystem, rootdir: string, walkfn: (path: string, isdir: boolean) => Error | void): Error | void {
	const err = walkfn(rootdir, true);
	if (err) {
		if (err === skipDir) {
			return;
		}
		return err;
	}
	const { files, directories } = fs.getFileSystemEntries(rootdir);
	for (const file of files) {
		const err = walkfn(path_.posix.join(rootdir, file), false);
		if (err) {
			return err;
		}
	}
	for (const dir of directories) {
		const err = walkInMemoryFs(fs, path_.posix.join(rootdir, dir), walkfn);
		if (err) {
			return err;
		}
	}
	return;
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
	constructor(fs: InMemoryFileSystem, rootFilePath: string, versions: Map<string, number>, configFilePath: string, configContent?: any, traceModuleResolution?: boolean) {
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
		this.initialized = undefined;
		this.ensuredBasicFiles = undefined;
		this.ensuredAllFiles = undefined;
		this.service = undefined;
		this.program = undefined;
		this.host = undefined;
	}

	/**
	 * @return package name (project name) of a given project
	 */
	getPackageName(): string | null {
		const pkgJsonFile = path_.posix.join(this.rootFilePath, 'package.json');
		if (this.fs.fileExists(pkgJsonFile)) {
			return JSON.parse(this.fs.readFile(pkgJsonFile)).name;
		}
		return null;
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

	private initialized?: Promise<void>;

	/**
	 * Initializes (sub)project by parsing configuration and making proper internal objects
	 */
	private init(): Promise<void> {
		if (this.initialized) {
			return this.initialized;
		}
		this.initialized = new Promise<void>((resolve, reject) => {
			let configObject;
			if (!this.configContent) {
				const jsonConfig = ts.parseConfigFileTextToJson(this.configFilePath, this.fs.readFile(this.configFilePath));
				if (jsonConfig.error) {
					console.error('Cannot parse ' + this.configFilePath + ': ' + jsonConfig.error.messageText);
					return reject(new Error('Cannot parse ' + this.configFilePath + ': ' + jsonConfig.error.messageText));
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
				return reject(err);
			}

			const options = configParseResult.options;
			if (/(^|\/)jsconfig\.json$/.test(this.configFilePath)) {
				options.allowJs = true;
			}
			if (this.traceModuleResolution) {
				options.traceResolution = true;
			}
			this.host = new InMemoryLanguageServiceHost(this.fs.path,
				options,
				this.fs,
				expFiles,
				this.versions);
			this.service = ts.createLanguageService(this.host, ts.createDocumentRegistry());
			this.program = this.service.getProgram();
			return resolve();
		});
		return this.initialized;
	}

	/**
	 * Ensures we are ready to process files from a given sub-project
	 */
	ensureConfigFile(): Promise<void> {
		return this.init();
	}

	private ensuredBasicFiles?: Promise<void>;

	/**
	 * Ensures we fetched basic files (global TS files, dependencies, declarations)
	 */
	async ensureBasicFiles(): Promise<void> {
		if (this.ensuredBasicFiles) {
			return this.ensuredBasicFiles;
		}

		this.ensuredBasicFiles = this.init().then(() => {
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
		});
		return this.ensuredBasicFiles;
	}

	private ensuredAllFiles?: Promise<void>;

	/**
	 * Ensures we fetched all project's source file (as were defined in tsconfig.json)
	 */
	async ensureAllFiles(): Promise<void> {
		if (this.ensuredAllFiles) {
			return this.ensuredAllFiles;
		}

		this.ensuredAllFiles = this.init().then(() => {
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
		});
		return this.ensuredAllFiles;
	}
}

/**
 * Indicates that tree traversal function should stop
 */
export const skipDir: Error = {
	name: 'WALK_FN_SKIP_DIR',
	message: ''
};

/**
 * TypeScript library files fetched from the local file system (bundled TS)
 */
let tsLibraries: Map<string, string>;

/**
 * Fetches TypeScript library files from local file system
 */
export function getTypeScriptLibraries(): Map<string, string> {
	if (!tsLibraries) {
		tsLibraries = new Map<string, string>();
		const path = path_.dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2015 }));
		fs_.readdirSync(path).forEach(file => {
			const fullPath = path_.join(path, file);
			if (fs_.statSync(fullPath).isFile()) {
				tsLibraries.set(util.normalizePath(fullPath), fs_.readFileSync(fullPath).toString());
			}
		});
	}
	return tsLibraries;
}
