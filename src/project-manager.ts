import * as path_ from 'path';
import * as fs_ from 'fs';

import * as ts from 'typescript';
import { IConnection, PublishDiagnosticsParams } from 'vscode-languageserver';
import * as async from 'async';

import * as FileSystem from './fs';
import * as util from './util';
import * as match from './match-files';

/**
 * ProjectManager translates VFS files to one or many projects denoted by [tj]config.json.
 * It uses either local or remote file system to fetch directory tree and files from and then
 * makes one or more LanguageService objects. By default all LanguageService objects contain no files,
 * they are added on demand - current file for hover or definition, project's files for references and 
 * all files from all projects for workspace symbols.
 */
export class ProjectManager {

    private root: string;
    private strict: boolean;

    private configs: Map<string, ProjectConfiguration>;

    private remoteFs: FileSystem.FileSystem;
    private localFs: InMemoryFileSystem;

    private versions: Map<string, number>;
    /**
     * fetched keeps track of which files in localFs have actually
     * been fetched from remoteFs. Some might have a placeholder
     * value.
     */
    private fetched: Set<string>;

    constructor(root: string, strict: boolean, connection: IConnection) {
        this.root = util.normalizePath(root);
        this.strict = strict;
        this.configs = new Map<string, ProjectConfiguration>();
        this.localFs = new InMemoryFileSystem(this.root);
        this.versions = new Map<string, number>();
        this.fetched = new Set<string>();

        if (strict) {
            this.remoteFs = new FileSystem.RemoteFileSystem(connection)
        } else {
            this.remoteFs = new FileSystem.LocalFileSystem(root)
        }
    }

    getRemoteRoot(): string {
        return this.root;
    }


    getFs(): InMemoryFileSystem {
        return this.localFs;
    }

	/**
	 * @return true if there is a file with a given name
	 */
    hasFile(name: string) {
        return this.localFs.fileExists(name);
    }

	/**
	 * Ensures that all files are added (and parsed) to the project to which fileName belongs. 
	 */
    syncConfigurationFor(fileName: string, connection: IConnection) {
        return this.syncConfiguration(this.getConfiguration(fileName), connection);
    }

	/**
	 * Ensures that all files are added (and parsed) for the given project.
	 * Uses tsconfig.json settings to identify what files make a project (root files)
	 */
    syncConfiguration(config: ProjectConfiguration, connection: IConnection) {
        if (config.host.complete) {
            return;
        }
        let changed = false;
        (config.host.expectedFiles || []).forEach((fileName) => {
            const sourceFile = config.program.getSourceFile(fileName);
            if (!sourceFile) {
                config.host.addFile(fileName);
                changed = true;
            }
        });
        if (changed) {
            // requery program object to synchonize LanguageService's data
            config.program = config.service.getProgram();
        }
        config.host.complete = true;
    }

	/**
	 * @return all projects
	 */
    getConfigurations(): ProjectConfiguration[] {
        const ret = [];
        this.configs.forEach((v, k) => {
            ret.push(v);
        });
        return ret;
    }

    // TODO: eliminate this method
    // we should process all subprojects instead
    getAnyConfiguration(): ProjectConfiguration {
        let config = null;
        this.configs.forEach((v) => {
            if (!config) {
                config = v;
            }
        });
        return config;
    }

    private ensuredModuleStructure: Promise<void> = null;

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
            this.ensuredModuleStructure = this.ensureModuleStructure_();
            this.ensuredModuleStructure.catch((err) => {
                console.error("Failed to fetch module structure:", err);
                this.ensuredModuleStructure = null;
            });
        }
        return this.ensuredModuleStructure;
    }

    private ensureModuleStructure_(): Promise<void> {
        const start = new Date().getTime();
        const self = this;
        const filesToFetch = [];
        return this.walkRemote(this.root, function (path: string, info: FileSystem.FileInfo, err?: Error): (Error | null) {
            if (err) {
                return err;
            } else if (info.dir) {
                return null;
            }
            const rel = path_.posix.relative(self.root, util.normalizePath(path));
            if (util.isGlobalTSFile(rel) || util.isConfigFile(rel) || util.isPackageJsonFile(rel)) {
                filesToFetch.push(path);
            } else {
                if (!self.localFs.fileExists(rel)) {
                    self.localFs.addFile(rel, "var dummy_0ff1bd;");
                }
            }
            return null;
        }).then(() => this.ensureFiles(filesToFetch));
    }

    /**
     * ensureFiles ensures the following files have been fetched to
     * localFs. The files parameter is expected to contain paths in
     * the remote FS. ensureFiles only syncs unfetched file content
     * from remoteFs to localFs. It does not update project
     * state. Callers that want to do so after file contents have been
     * fetched should call this.refreshConfigurations().
     */
    ensureFiles(files: string[]): Promise<void> {
        const filesToFetch = files.filter((f) => !this.fetched.has(f));
        if (filesToFetch.length === 0) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            this.fetchContent(filesToFetch, (err) => {
                if (err) {
                    return reject(err);
                }
                filesToFetch.forEach((f) => this.fetched.add(util.normalizePath(f)));
                return resolve();
            });
        });
    }

    walkRemote(root: string, walkfn: (path: string, info: FileSystem.FileInfo, err?: Error) => Error | null): Promise<void> {
        const info = {
            name: root,
            size: 0,
            dir: true,
        }
        return this.walkRemoter(root, info, walkfn);
    }

    private walkRemoter(path: string, info: FileSystem.FileInfo, walkfn: (path: string, info: FileSystem.FileInfo, err?: Error) => Error | null): Promise<void> {
        if (info.name.indexOf('/.') >= 0) {
            return Promise.resolve();
        }

        const err = walkfn(path, info);
        if (err === skipDir) {
            return Promise.resolve();
        } else if (err) {
            return Promise.reject(err);
        }

        if (!info.dir) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
            this.fetchDir(path)((err: Error, result?: FileSystem.FileInfo[]) => {
                if (err) {
                    const err2 = walkfn(path, info, err);
                    if (err2) {
                        return reject(err);
                    } else {
                        return resolve();
                    }
                }

                Promise.all(result.map((fi) => this.walkRemoter(fi.name, fi, walkfn))).then(() => {
                    return resolve();
                }, (err) => {
                    return reject(err);
                });
            });
        });
    }


	/**
	 * @return project configuration for a given source file. Climbs directory tree up to workspace root if needed 
	 */
    getConfiguration(fileName: string): ProjectConfiguration {
        let dir = path_.posix.dirname(fileName);
        let config;
        while (dir && dir != this.root) {
            config = this.configs.get(dir);
            if (config) {
                return config;
            }
            dir = path_.posix.dirname(dir);
            if (dir == '.') {
                dir = '';
            }
        }
        return this.configs.get('');
    }

    didOpen(fileName: string, text: string, connection: IConnection) {
        this.didChange(fileName, text, connection);
    }

    didClose(fileName: string, connection: IConnection) {
        this.localFs.didClose(fileName);
        let version = this.versions.get(fileName) || 0;
        this.versions.set(fileName, ++version);
        this.getConfiguration(fileName).prepare(null).then((config) => {
            config.host.incProjectVersion();
            config.program = config.service.getProgram();
        });
    }

    didChange(fileName: string, text: string, connection: IConnection) {
        this.localFs.didChange(fileName, text);
        let version = this.versions.get(fileName) || 0;
        this.versions.set(fileName, ++version);
        this.getConfiguration(fileName).prepare(null).then((config) => {
            config.host.incProjectVersion();
            config.program = config.service.getProgram();
        });
    }

    didSave(fileName: string) {
        this.localFs.didSave(fileName);
    }


    /**
     * @return asynchronous function that fetches directory content from VFS
     */
    private fetchDir(path: string): AsyncFunction<FileSystem.FileInfo[]> {
        return (callback: (err?: Error, result?: FileSystem.FileInfo[]) => void) => {
            this.remoteFs.readDir(path, (err?: Error, result?: FileSystem.FileInfo[]) => {
                if (result) {
                    result.forEach((fi) => {
                        fi.name = path_.posix.join(path, fi.name)
                    })
                }
                return callback(err, result)
            });
        }
    }

    /**
     * Fetches content of the specified files
     */
    private fetchContent(files: string[], callback: (err?: Error) => void) {
        if (!files || files.length === 0) {
            return callback();
        }

        let tasks = [];
        const fetch = (path: string): AsyncFunction<string> => {
            return (callback: (err?: Error, result?: string) => void) => {
                this.remoteFs.readFile(path, (err?: Error, result?: string) => {
                    if (err) {
                        console.error('Unable to fetch content of ' + path, err);
                        // There is a chance that we request not-existent file.
                        result = '';
                    }
                    const rel = path_.posix.relative(this.root, path);
                    this.localFs.addFile(rel, result);
                    return callback()
                })
            }
        };
        files.forEach((path) => {
            tasks.push(fetch(path))
        });
        const start = new Date().getTime();
        // Why parallelLimit: There may be too many open files when working with local FS and trying
        // to open them in parallel
        async.parallelLimit(tasks, 100, (err) => {
            console.error('files fetched in', (new Date().getTime() - start) / 1000.0);
            return callback(err);
        });
    }

    /**
     * Detects projects denoted by tsconfig.json
     */
    refreshConfigurations() {
        const rootdirs = new Set<string>();
        Object.keys(this.localFs.entries).forEach((k) => {
            if (!/(^|\/)[tj]sconfig\.json$/.test(k)) {
                return;
            }
            if (/(^|\/)node_modules\//.test(k)) {
                return;
            }
            let dir = path_.posix.dirname(k);
            if (dir == '.') {
                dir = '';
            }
            this.configs.set(dir, new ProjectConfiguration(this.localFs, this.versions, k));
            rootdirs.add(dir);
        });
        if (!rootdirs.has('')) {
            // collecting all the files in workspace by making fake configuration object
            this.configs.set('', new ProjectConfiguration(this.localFs, this.versions, '', {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    allowNonTsExtensions: false,
                    allowJs: true
                }
            }));
        }
    }
}

/**
 * Implementaton of LanguageServiceHost that works with in-memory file system
 */
class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {

    complete: boolean;

    private root: string;
    private options: ts.CompilerOptions;
    private fs: InMemoryFileSystem;
    expectedFiles: string[];

    private files: string[];

    private projectVersion: number;

    private versions: Map<string, number>;

    constructor(root: string, options: ts.CompilerOptions, fs: InMemoryFileSystem, expectedFiles: string[], versions: Map<string, number>) {
        this.root = root;
        this.options = options;
        this.fs = fs;
        this.expectedFiles = expectedFiles;
        this.versions = versions;
        this.projectVersion = 1;
        this.files = [];
        // adding library files from the local file system
        readTsLibraries().forEach((content, name) => {
            this.fs.entries[name] = content;
        });
    }

    /**
     * TypeScript uses this method (when present) to compare project's version 
     * with the last known one to decide if internal data should be synchronized
     */
    getProjectVersion(): string {
        return '' + this.projectVersion;
    }

    incProjectVersion() {
        this.projectVersion++;
    }

    getCompilationSettings(): ts.CompilerOptions {
        return this.options;
    }

    getScriptFileNames(): string[] {
        return this.files;
    }

    /**
     * Adds a file and increments project version, used in conjunction with getProjectVersion()
     * which may be called by TypeScript to check if internal data is up to date
     */
    addFile(fileName: string) {
        this.files.push(fileName);
        this.incProjectVersion();
    }

    getScriptVersion(fileName: string): string {
        if (path_.posix.isAbsolute(fileName) || path_.isAbsolute(fileName)) {
            fileName = path_.posix.relative(this.root, util.normalizePath(fileName));
        }
        let version = this.versions.get(fileName);
        if (!version) {
            version = 1;
            this.versions.set(fileName, version);
        }
        return "" + version;
    }

    getScriptSnapshot(fileName: string): ts.IScriptSnapshot {
        let entry = this.fs.readFile(fileName);
        if (!entry) {
            fileName = path_.posix.relative(this.root, fileName);
            entry = this.fs.readFile(fileName);
        }
        if (!entry) {
            return undefined;
        }
        return ts.ScriptSnapshot.fromString(entry);
    }

    getCurrentDirectory(): string {
        return this.root;
    }

    getDefaultLibFileName(options: ts.CompilerOptions): string {
        return util.normalizePath(ts.getDefaultLibFilePath(options));
    }

    trace(message: string) {
        console.error(message);
    }

    log(message: string) {
        console.error(message);
    }

    error(message: string) {
        console.error(message);
    }


}

/**
 * In-memory file system, can be served as a ParseConfigHost (thus allowing listing files that belong to project based on tsconfig.json options)
 */
export class InMemoryFileSystem implements ts.ParseConfigHost, ts.ModuleResolutionHost {

    entries: any;
    overlay: any;


    useCaseSensitiveFileNames: boolean;

    path: string;

    private rootNode: any;

    constructor(path: string) {
        this.path = path;
        this.entries = {};
        this.overlay = {};
        this.rootNode = {};
    }

    addFile(path: string, content: string) {
        this.entries[path] = content;
        let node = this.rootNode;
        path.split('/').forEach((component, i, components) => {
            const n = node[component];
            if (!n) {
                node[component] = i == components.length - 1 ? '*' : {};
                node = node[component];
            } else {
                node = n;
            }
        });
    }

    fileExists(path: string): boolean {
        return this.readFile(path) !== undefined;
    }

    readFile(path: string): string {
        let content = this.overlay[path];
        if (content !== undefined) {
            return content;
        }

        const rel = path_.posix.relative('/', path);

        content = this.overlay[rel];
        if (content !== undefined) {
            return content;
        }

        content = this.entries[path];
        if (content !== undefined) {
            return content;
        }

        return this.entries[rel];
    }

    didClose(path: string) {
        delete this.overlay[path];
    }

    didSave(path: string) {
        this.addFile(path, this.readFile(path));
    }

    didChange(path: string, text: string) {
        this.overlay[path] = text;
    }

    readDirectory(rootDir: string, extensions: string[], excludes: string[], includes: string[]): string[] {
        return match.matchFiles(rootDir,
            extensions,
            excludes,
            includes,
            true,
            this.path,
            (p) => this.getFileSystemEntries(p));
    }

    getFileSystemEntries(path: string): match.FileSystemEntries {
        path = path_.posix.relative(this.path, path);
        const ret = { files: [], directories: [] };
        let node = this.rootNode;
        const components = path.split('/');
        if (components.length != 1 || components[0]) {
            components.forEach((component) => {
                const n = node[component];
                if (!n) {
                    return ret;
                }
                node = n;
            });
        }
        Object.keys(node).forEach((name) => {
            if (typeof node[name] == 'string') {
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
 * Project configuration holder
 */
export class ProjectConfiguration {

    service: ts.LanguageService;
    program: ts.Program;
    host: InMemoryLanguageServiceHost;

    private promise: Promise<ProjectConfiguration>;

    private fs: InMemoryFileSystem;
    private configFileName: string;
    private configContent: any;
    private versions: Map<string, number>;

    /**
     * @param fs file system to use
     * @param configFileName configuration file name (relative to workspace root)
     * @param configContent optional configuration content to use instead of reading configuration file)
     */
    constructor(fs: InMemoryFileSystem, versions: Map<string, number>, configFileName: string, configContent?: any) {
        this.fs = fs;
        this.configFileName = configFileName;
        this.configContent = configContent;
        this.versions = versions;
    }

    moduleResolutionHost(): ts.ModuleResolutionHost {
        return this.fs;
    }

    prepare(connection: IConnection): Promise<ProjectConfiguration> {
        if (!this.promise) {
            this.promise = new Promise<ProjectConfiguration>((resolve, reject) => {
                let configObject;
                if (!this.configContent) {
                    const jsonConfig = ts.parseConfigFileTextToJson(this.configFileName, this.fs.readFile(this.configFileName));
                    if (jsonConfig.error) {
                        console.error('Cannot parse ' + this.configFileName + ': ' + jsonConfig.error.messageText);
                        return reject(new Error('Cannot parse ' + this.configFileName + ': ' + jsonConfig.error.messageText));
                    }
                    configObject = jsonConfig.config;
                } else {
                    configObject = this.configContent;
                }
                let dir = path_.posix.dirname(this.configFileName);
                if (dir == '.') {
                    dir = '';
                }
                const base = dir || this.fs.path;
                const configParseResult = ts.parseJsonConfigFileContent(configObject, this.fs, base);
                const options = configParseResult.options;
                if (/(^|\/)jsconfig\.json$/.test(this.configFileName)) {
                    options.allowJs = true;
                }
                this.host = new InMemoryLanguageServiceHost(this.fs.path,
                    options,
                    this.fs,
                    configParseResult.fileNames,
                    this.versions);
                this.service = ts.createLanguageService(this.host, ts.createDocumentRegistry());
                this.program = this.service.getProgram();
                return resolve(this);
            });
        }
        return this.promise;
    }
}

export const skipDir: Error = {
    name: "WALK_FN_SKIP_DIR",
    message: "",
}

var tsLibraries: Map<string, string>;

/**
 * Fetches TypeScript library files from local file system
 */
function readTsLibraries(): Map<string, string> {
    if (!tsLibraries) {
        tsLibraries = new Map<string, string>();
        const path = path_.dirname(ts.getDefaultLibFilePath({ target: 2 }));
        fs_.readdirSync(path).forEach((file) => {
            const fullPath = path_.join(path, file);
            if (fs_.statSync(fullPath).isFile()) {
                tsLibraries.set(util.normalizePath(fullPath), fs_.readFileSync(fullPath).toString());
            }
        });
    }
    return tsLibraries;
}
