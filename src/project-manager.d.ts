/// <reference types="node" />
import * as ts from 'typescript';
import * as FileSystem from './fs';
import * as match from './match-files';
/**
 * ProjectManager translates VFS files to one or many projects denoted by [tj]config.json.
 * It uses either local or remote file system to fetch directory tree and files from and then
 * makes one or more LanguageService objects. By default all LanguageService objects contain no files,
 * they are added on demand - current file for hover or definition, project's files for references and
 * all files from all projects for workspace symbols.
 */
export declare class ProjectManager {
    private root;
    private configs;
    private strict;
    private remoteFs;
    private localFs;
    private versions;
    private traceModuleResolution;
    /**
     * fetched keeps track of which files in localFs have actually
     * been fetched from remoteFs. (Some might have a placeholder
     * value). If a file has already been successfully fetched, we
     * won't fetch it again. This should be cleared if remoteFs files
     * have been modified in some way, but does not need to be cleared
     * if remoteFs files have only been added.
     */
    private fetched;
    constructor(root: string, remoteFs: FileSystem.FileSystem, strict: boolean, traceModuleResolution?: boolean);
    getRemoteRoot(): string;
    getFs(): InMemoryFileSystem;
    /**
     * @return true if there is a file with a given name
     */
    hasFile(name: string): boolean;
    /**
     * @return all projects
     */
    getConfigurations(): ProjectConfiguration[];
    private ensuredModuleStructure?;
    /**
     * ensureModuleStructure ensures that the module structure of the
     * project exists in localFs. TypeScript/JavaScript module
     * structure is determined by [jt]sconfig.json, filesystem layout,
     * global*.d.ts files. For performance reasons, we only read in
     * the contents of some files and store "var dummy_0ff1bd;" as the
     * contents of all other files.
     */
    ensureModuleStructure(): Promise<void>;
    refreshModuleStructureAt(root: string): Promise<void>;
    private ensuredFilesForHoverAndDefinition;
    ensureFilesForHoverAndDefinition(uri: string): Promise<void>;
    private ensuredFilesForWorkspaceSymbol?;
    ensureFilesForWorkspaceSymbol(): Promise<void>;
    private ensuredAllFiles?;
    ensureFilesForReferences(uri: string): Promise<void>;
    private ensureTransitiveFileDependencies(fileNames, maxDepth, seen);
    /**
     * ensureFiles ensures the following files have been fetched to
     * localFs. The files parameter is expected to contain paths in
     * the remote FS. ensureFiles only syncs unfetched file content
     * from remoteFs to localFs. It does not update project
     * state. Callers that want to do so after file contents have been
     * fetched should call this.refreshConfigurations().
     */
    ensureFiles(files: string[]): Promise<void>;
    walkRemote(root: string, walkfn: (path: string, info: FileSystem.FileInfo, err?: Error) => Error | null): Promise<void>;
    private walkRemoter(path, info, walkfn);
    /**
     * @return project configuration for a given source file. Climbs directory tree up to workspace root if needed
     */
    getConfiguration(fileName: string): ProjectConfiguration;
    didOpen(fileName: string, text: string): void;
    didClose(fileName: string): void;
    didChange(fileName: string, text: string): void;
    didSave(fileName: string): void;
    /**
     * @return asynchronous function that fetches directory content from VFS
     */
    private fetchDir(path);
    /**
     * Fetches content of the specified files
     */
    private fetchContent(files, callback);
    /**
     * Detects projects and creates projects denoted by tsconfig.json. Previously detected projects are discarded.
     */
    refreshConfigurations(): void;
}
/**
 * Implementaton of LanguageServiceHost that works with in-memory file system
 */
export declare class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {
    complete: boolean;
    private root;
    private options;
    private fs;
    expectedFiles: string[];
    private files;
    private projectVersion;
    private versions;
    constructor(root: string, options: ts.CompilerOptions, fs: InMemoryFileSystem, expectedFiles: string[], versions: Map<string, number>);
    /**
     * TypeScript uses this method (when present) to compare project's version
     * with the last known one to decide if internal data should be synchronized
     */
    getProjectVersion(): string;
    incProjectVersion(): void;
    getCompilationSettings(): ts.CompilerOptions;
    getScriptFileNames(): string[];
    /**
     * Adds a file and increments project version, used in conjunction with getProjectVersion()
     * which may be called by TypeScript to check if internal data is up to date
     */
    addFile(fileName: string): void;
    getScriptVersion(fileName: string): string;
    getScriptSnapshot(fileName: string): ts.IScriptSnapshot;
    getCurrentDirectory(): string;
    getDefaultLibFileName(options: ts.CompilerOptions): string;
    trace(message: string): void;
    log(message: string): void;
    error(message: string): void;
}
/**
 * In-memory file system, can be served as a ParseConfigHost (thus allowing listing files that belong to project based on tsconfig.json options)
 */
export declare class InMemoryFileSystem implements ts.ParseConfigHost, ts.ModuleResolutionHost {
    entries: any;
    overlay: any;
    useCaseSensitiveFileNames: boolean;
    path: string;
    rootNode: any;
    constructor(path: string);
    addFile(path: string, content: string): void;
    fileExists(path: string): boolean;
    readFile(path: string): string;
    didClose(path: string): void;
    didSave(path: string): void;
    didChange(path: string, text: string): void;
    readDirectory(rootDir: string, extensions: string[], excludes: string[], includes: string[]): string[];
    getFileSystemEntries(path: string): match.FileSystemEntries;
    trace(message: string): void;
}
export declare function walkInMemoryFs(fs: InMemoryFileSystem, rootdir: string, walkfn: (path: string, isdir: boolean) => Error | void): Error | void;
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
export declare class ProjectConfiguration {
    private service?;
    private program?;
    private host?;
    private fs;
    private configFileName;
    private configContent;
    private versions;
    private traceModuleResolution;
    /**
     * @param fs file system to use
     * @param configFileName configuration file name (relative to workspace root)
     * @param configContent optional configuration content to use instead of reading configuration file)
     */
    constructor(fs: InMemoryFileSystem, versions: Map<string, number>, configFileName: string, configContent?: any, traceModuleResolution?: boolean);
    moduleResolutionHost(): ts.ModuleResolutionHost;
    /**
     * reset resets a ProjectConfiguration to its state immediately
     * after construction. It should be called whenever the underlying
     * local filesystem (fs) has changed, and so the
     * ProjectConfiguration can no longer assume its state reflects
     * that of the underlying files.
     */
    reset(): void;
    getService(): ts.LanguageService;
    getProgram(): ts.Program;
    getHost(): InMemoryLanguageServiceHost;
    syncProgram(): void;
    private initialized?;
    private init();
    ensureConfigFile(): Promise<void>;
    private ensuredBasicFiles?;
    ensureBasicFiles(): Promise<void>;
    private ensuredAllFiles?;
    ensureAllFiles(): Promise<void>;
}
export declare const skipDir: Error;
/**
 * Fetches TypeScript library files from local file system
 */
export declare function getTypeScriptLibraries(): Map<string, string>;
