"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const path_ = require("path");
const fs_ = require("fs");
const os = require("os");
const ts = require("typescript");
const async = require("async");
const util = require("./util");
const match = require("./match-files");
/**
 * ProjectManager translates VFS files to one or many projects denoted by [tj]config.json.
 * It uses either local or remote file system to fetch directory tree and files from and then
 * makes one or more LanguageService objects. By default all LanguageService objects contain no files,
 * they are added on demand - current file for hover or definition, project's files for references and
 * all files from all projects for workspace symbols.
 */
class ProjectManager {
    constructor(root, remoteFs, strict, traceModuleResolution) {
        this.ensuredFilesForHoverAndDefinition = new Map();
        this.root = util.normalizePath(root);
        this.configs = new Map();
        this.localFs = new InMemoryFileSystem(this.root);
        this.versions = new Map();
        this.fetched = new Set();
        this.remoteFs = remoteFs;
        this.strict = strict;
        this.traceModuleResolution = traceModuleResolution || false;
    }
    getRemoteRoot() {
        return this.root;
    }
    getFs() {
        return this.localFs;
    }
    /**
     * @return true if there is a file with a given name
     */
    hasFile(name) {
        return this.localFs.fileExists(name);
    }
    /**
     * @return all projects
     */
    getConfigurations() {
        const ret = [];
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
    ensureModuleStructure() {
        if (!this.ensuredModuleStructure) {
            this.ensuredModuleStructure = this.refreshModuleStructureAt(this.root).then(() => {
                this.refreshConfigurations();
            });
            this.ensuredModuleStructure.catch((err) => {
                console.error("Failed to fetch module structure:", err);
                this.ensuredModuleStructure = undefined;
            });
        }
        return this.ensuredModuleStructure;
    }
    /*
     * refreshModuleStructureAt refreshes the local in-memory
     * filesytem's (this.localFs) files under the specified path
     * (root) with the contents of the remote filesystem
     * (this.remoteFs). It will also reset the ProjectConfigurations
     * that are affected by the refreshed files.
     *
     * This method is public because a ProjectManager instance assumes
     * there are no changes made to the remote filesystem structure
     * after initialization. If such changes are made, it is necessary
     * to call this method to alert the ProjectManager instance of the
     * change.
     */
    refreshModuleStructureAt(root) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!root.startsWith('/')) {
                root = '/' + root;
            }
            if (root !== '/' && root.endsWith('/')) {
                root = root.substring(0, root.length - 1);
            }
            const filesToFetch = [];
            yield this.walkRemote(root, (path, info, err) => {
                if (err) {
                    return err;
                }
                else if (info.dir) {
                    return null;
                }
                const rel = path_.posix.relative(this.root, util.normalizePath(path));
                if (util.isGlobalTSFile(rel) || util.isConfigFile(rel) || util.isPackageJsonFile(rel)) {
                    filesToFetch.push(path);
                }
                else {
                    if (!this.localFs.fileExists(rel)) {
                        this.localFs.addFile(rel, localFSPlaceholder);
                    }
                }
                return null;
            });
            yield this.ensureFiles(filesToFetch);
            // require re-fetching of dependency files (but not for
            // workspace/symbol and textDocument/references, because those
            // should not be affected by new external modules)
            this.ensuredFilesForHoverAndDefinition.clear();
            // require re-parsing of projects whose file set may have been affected
            for (let [dir, config] of this.configs) {
                if (!dir.startsWith('/')) {
                    dir = '/' + dir;
                }
                if (dir !== '/' && dir.endsWith('/')) {
                    dir = dir.substring(0, dir.length - 1);
                }
                if (dir.startsWith(root + '/') || root.startsWith(dir + '/') || root === dir) {
                    config.reset();
                }
            }
        });
    }
    ensureFilesForHoverAndDefinition(uri) {
        const existing = this.ensuredFilesForHoverAndDefinition.get(uri);
        if (existing) {
            return existing;
        }
        const promise = this.ensureModuleStructure().then(() => {
            // include dependencies up to depth 30
            const deps = new Set();
            return this.ensureTransitiveFileDependencies([util.uri2path(uri)], 30, deps).then(() => {
                return this.refreshConfigurations();
            });
        });
        this.ensuredFilesForHoverAndDefinition.set(uri, promise);
        promise.catch((err) => {
            console.error("Failed to fetch files for hover/definition for uri ", uri, ", error:", err);
            this.ensuredFilesForHoverAndDefinition.delete(uri);
        });
        return promise;
    }
    ensureFilesForWorkspaceSymbol() {
        if (this.ensuredFilesForWorkspaceSymbol) {
            return this.ensuredFilesForWorkspaceSymbol;
        }
        const filesToEnsure = [];
        const promise = this.walkRemote(this.getRemoteRoot(), function (path, info, err) {
            if (err) {
                return err;
            }
            else if (info.dir) {
                if (util.normalizePath(info.name).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
                    return exports.skipDir;
                }
                else {
                    return null;
                }
            }
            if (util.isJSTSFile(path) || util.isConfigFile(path) || util.isPackageJsonFile(path)) {
                filesToEnsure.push(path);
            }
            return null;
        }).then(() => {
            return this.ensureFiles(filesToEnsure);
        }).then(() => {
            return this.refreshConfigurations();
        });
        this.ensuredFilesForWorkspaceSymbol = promise;
        promise.catch((err) => {
            console.error("Failed to fetch files for workspace/symbol:", err);
            this.ensuredFilesForWorkspaceSymbol = undefined;
        });
        return promise;
    }
    ensureFilesForReferences(uri) {
        const fileName = util.uri2path(uri);
        if (util.normalizePath(fileName).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
            return this.ensureFilesForWorkspaceSymbol();
        }
        if (this.ensuredAllFiles) {
            return this.ensuredAllFiles;
        }
        const filesToEnsure = [];
        const promise = this.walkRemote(this.getRemoteRoot(), function (path, info, err) {
            if (err) {
                return err;
            }
            else if (info.dir) {
                return null;
            }
            if (util.isJSTSFile(path)) {
                filesToEnsure.push(path);
            }
            return null;
        }).then(() => {
            return this.ensureFiles(filesToEnsure);
        }).then(() => {
            return this.refreshConfigurations();
        });
        this.ensuredAllFiles = promise;
        promise.catch((err) => {
            console.error("Failed to fetch files for references:", err);
            this.ensuredAllFiles = undefined;
        });
        return promise;
    }
    ensureTransitiveFileDependencies(fileNames, maxDepth, seen) {
        return __awaiter(this, void 0, void 0, function* () {
            fileNames = fileNames.filter((f) => !seen.has(f));
            if (fileNames.length === 0) {
                return Promise.resolve();
            }
            fileNames.forEach((f) => seen.add(f));
            const absFileNames = fileNames.map((f) => util.normalizePath(util.resolve(this.root, f)));
            yield this.ensureFiles(absFileNames);
            if (maxDepth > 0) {
                const importFiles = new Set();
                yield Promise.all(fileNames.map((fileName) => __awaiter(this, void 0, void 0, function* () {
                    const config = this.getConfiguration(fileName);
                    yield config.ensureBasicFiles();
                    const contents = this.getFs().readFile(fileName) || '';
                    const info = ts.preProcessFile(contents, true, true);
                    const compilerOpt = config.getHost().getCompilationSettings();
                    for (const imp of info.importedFiles) {
                        const resolved = ts.resolveModuleName(imp.fileName, fileName, compilerOpt, config.moduleResolutionHost());
                        if (!resolved || !resolved.resolvedModule) {
                            // This means we didn't find a file defining
                            // the module. It could still exist as an
                            // ambient module, which is why we fetch
                            // global*.d.ts files.
                            continue;
                        }
                        importFiles.add(resolved.resolvedModule.resolvedFileName);
                    }
                    const resolver = !this.strict && os.platform() == 'win32' ? path_ : path_.posix;
                    for (const ref of info.referencedFiles) {
                        // Resolving triple slash references relative to current file
                        // instead of using module resolution host because it behaves
                        // differently in "nodejs" mode
                        const refFileName = util.normalizePath(path_.relative(this.root, resolver.resolve(this.root, resolver.dirname(fileName), ref.fileName)));
                        importFiles.add(refFileName);
                    }
                })));
                yield this.ensureTransitiveFileDependencies(Array.from(importFiles), maxDepth - 1, seen);
            }
            ;
        });
    }
    /**
     * ensureFiles ensures the following files have been fetched to
     * localFs. The files parameter is expected to contain paths in
     * the remote FS. ensureFiles only syncs unfetched file content
     * from remoteFs to localFs. It does not update project
     * state. Callers that want to do so after file contents have been
     * fetched should call this.refreshConfigurations().
     */
    ensureFiles(files) {
        const filesToFetch = files;
        if (filesToFetch.length === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            this.fetchContent(filesToFetch, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }
    walkRemote(root, walkfn) {
        const info = {
            name: root,
            size: 0,
            dir: true,
        };
        return this.walkRemoter(root, info, walkfn);
    }
    walkRemoter(path, info, walkfn) {
        if (info.name.indexOf('/.') >= 0) {
            return Promise.resolve();
        }
        const err = walkfn(path, info);
        if (err === exports.skipDir) {
            return Promise.resolve();
        }
        else if (err) {
            return Promise.reject(err);
        }
        if (!info.dir) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            this.fetchDir(path)((err, result) => {
                if (err) {
                    const err2 = walkfn(path, info, err);
                    if (err2) {
                        return reject(err);
                    }
                    else {
                        return resolve();
                    }
                }
                if (result) {
                    Promise.all(result.map((fi) => this.walkRemoter(fi.name, fi, walkfn))).then(() => resolve(), reject);
                }
            });
        });
    }
    /**
     * @return project configuration for a given source file. Climbs directory tree up to workspace root if needed
     */
    getConfiguration(fileName) {
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
        config = this.configs.get('');
        if (config) {
            return config;
        }
        throw new Error("unreachable");
    }
    didOpen(fileName, text) {
        this.didChange(fileName, text);
    }
    didClose(fileName) {
        this.localFs.didClose(fileName);
        let version = this.versions.get(fileName) || 0;
        this.versions.set(fileName, ++version);
        const config = this.getConfiguration(fileName);
        config.ensureConfigFile().then(() => {
            config.getHost().incProjectVersion();
            config.syncProgram();
        });
    }
    didChange(fileName, text) {
        this.localFs.didChange(fileName, text);
        let version = this.versions.get(fileName) || 0;
        this.versions.set(fileName, ++version);
        const config = this.getConfiguration(fileName);
        config.ensureConfigFile().then(() => {
            config.getHost().incProjectVersion();
            config.syncProgram();
        });
    }
    didSave(fileName) {
        this.localFs.didSave(fileName);
    }
    /**
     * @return asynchronous function that fetches directory content from VFS
     */
    fetchDir(path) {
        return (callback) => {
            this.remoteFs.readDir(path, (err, result) => {
                if (result) {
                    result.forEach((fi) => {
                        fi.name = path_.posix.join(path, fi.name);
                    });
                }
                return callback(err, result);
            });
        };
    }
    /**
     * Fetches content of the specified files
     */
    fetchContent(files, callback) {
        if (!files) {
            return callback();
        }
        files = files.filter((f) => !this.fetched.has(f));
        if (files.length === 0) {
            return callback();
        }
        const fetch = (path) => {
            return (callback) => {
                this.remoteFs.readFile(path, (err, result) => {
                    if (err) {
                        console.error('Unable to fetch content of ' + path, err);
                        // There is a chance that we request not-existent file.
                        const rel = path_.posix.relative(this.root, path);
                        this.localFs.addFile(rel, '');
                        return callback();
                    }
                    const rel = path_.posix.relative(this.root, path);
                    this.localFs.addFile(rel, result || '');
                    this.fetched.add(util.normalizePath(path));
                    return callback();
                });
            };
        };
        let tasks = files.map(fetch);
        const start = new Date().getTime();
        // Why parallelLimit: There may be too many open files when working with local FS and trying
        // to open them in parallel
        async.parallelLimit(tasks, 100, (err) => {
            console.error('files fetched in', (new Date().getTime() - start) / 1000.0);
            return callback(err);
        });
    }
    /**
     * Detects projects and creates projects denoted by tsconfig.json. Previously detected projects are discarded.
     */
    refreshConfigurations() {
        const rootdirs = new Set();
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
            this.configs.set(dir, new ProjectConfiguration(this.localFs, this.versions, k, undefined, this.traceModuleResolution));
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
            }, this.traceModuleResolution));
        }
    }
}
exports.ProjectManager = ProjectManager;
/**
 * Implementaton of LanguageServiceHost that works with in-memory file system
 */
class InMemoryLanguageServiceHost {
    constructor(root, options, fs, expectedFiles, versions) {
        this.root = root;
        this.options = options;
        this.fs = fs;
        this.expectedFiles = expectedFiles;
        this.versions = versions;
        this.projectVersion = 1;
        this.files = [];
        // adding library files from the local file system
        getTypeScriptLibraries().forEach((content, name) => {
            this.fs.entries[name] = content;
        });
    }
    /**
     * TypeScript uses this method (when present) to compare project's version
     * with the last known one to decide if internal data should be synchronized
     */
    getProjectVersion() {
        return '' + this.projectVersion;
    }
    incProjectVersion() {
        this.projectVersion++;
    }
    getCompilationSettings() {
        return this.options;
    }
    getScriptFileNames() {
        return this.files;
    }
    /**
     * Adds a file and increments project version, used in conjunction with getProjectVersion()
     * which may be called by TypeScript to check if internal data is up to date
     */
    addFile(fileName) {
        this.files.push(fileName);
        this.incProjectVersion();
    }
    getScriptVersion(fileName) {
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
    getScriptSnapshot(fileName) {
        let entry = this.fs.readFile(fileName);
        if (!entry) {
            fileName = path_.posix.join(this.root, fileName);
            entry = this.fs.readFile(fileName);
        }
        if (!entry) {
            return undefined;
        }
        return ts.ScriptSnapshot.fromString(entry);
    }
    getCurrentDirectory() {
        return this.root;
    }
    getDefaultLibFileName(options) {
        return util.normalizePath(ts.getDefaultLibFilePath(options));
    }
    trace(message) {
        console.error(message);
    }
    log(message) {
        console.error(message);
    }
    error(message) {
        console.error(message);
    }
}
exports.InMemoryLanguageServiceHost = InMemoryLanguageServiceHost;
const localFSPlaceholder = "var dummy_0ff1bd;";
/**
 * In-memory file system, can be served as a ParseConfigHost (thus allowing listing files that belong to project based on tsconfig.json options)
 */
class InMemoryFileSystem {
    constructor(path) {
        this.path = path;
        this.entries = {};
        this.overlay = {};
        this.rootNode = {};
    }
    addFile(path, content) {
        this.entries[path] = content;
        let node = this.rootNode;
        path.split('/').forEach((component, i, components) => {
            const n = node[component];
            if (!n) {
                node[component] = (i === components.length - 1) ? '*' : {};
                node = node[component];
            }
            else {
                node = n;
            }
        });
    }
    fileExists(path) {
        return this.readFile(path) !== undefined;
    }
    readFile(path) {
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
    didClose(path) {
        delete this.overlay[path];
    }
    didSave(path) {
        this.addFile(path, this.readFile(path));
    }
    didChange(path, text) {
        this.overlay[path] = text;
    }
    readDirectory(rootDir, extensions, excludes, includes) {
        return match.matchFiles(rootDir, extensions, excludes, includes, true, this.path, (p) => this.getFileSystemEntries(p));
    }
    getFileSystemEntries(path) {
        const ret = { files: [], directories: [] };
        let node = this.rootNode;
        const components = path.split('/').filter((c) => c);
        if (components.length != 1 || components[0]) {
            for (const component of components) {
                const n = node[component];
                if (!n) {
                    return ret;
                }
                node = n;
            }
        }
        Object.keys(node).forEach((name) => {
            if (typeof node[name] === 'string') {
                ret.files.push(name);
            }
            else {
                ret.directories.push(name);
            }
        });
        return ret;
    }
    trace(message) {
        console.error(message);
    }
}
exports.InMemoryFileSystem = InMemoryFileSystem;
function walkInMemoryFs(fs, rootdir, walkfn) {
    const err = walkfn(rootdir, true);
    if (err) {
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
exports.walkInMemoryFs = walkInMemoryFs;
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
class ProjectConfiguration {
    /**
     * @param fs file system to use
     * @param configFileName configuration file name (relative to workspace root)
     * @param configContent optional configuration content to use instead of reading configuration file)
     */
    constructor(fs, versions, configFileName, configContent, traceModuleResolution) {
        this.fs = fs;
        this.configFileName = configFileName;
        this.configContent = configContent;
        this.versions = versions;
        this.traceModuleResolution = traceModuleResolution || false;
    }
    moduleResolutionHost() {
        return this.fs;
    }
    /**
     * reset resets a ProjectConfiguration to its state immediately
     * after construction. It should be called whenever the underlying
     * local filesystem (fs) has changed, and so the
     * ProjectConfiguration can no longer assume its state reflects
     * that of the underlying files.
     */
    reset() {
        this.initialized = undefined;
        this.ensuredBasicFiles = undefined;
        this.ensuredAllFiles = undefined;
        this.service = undefined;
        this.program = undefined;
        this.host = undefined;
    }
    getService() {
        if (!this.service) {
            throw new Error("project is uninitialized");
        }
        return this.service;
    }
    getProgram() {
        if (!this.program) {
            throw new Error("project is uninitialized");
        }
        return this.program;
    }
    getHost() {
        if (!this.host) {
            throw new Error("project is uninitialized");
        }
        return this.host;
    }
    syncProgram() {
        this.program = this.getService().getProgram();
    }
    init() {
        if (this.initialized) {
            return this.initialized;
        }
        this.initialized = new Promise((resolve, reject) => {
            let configObject;
            if (!this.configContent) {
                const jsonConfig = ts.parseConfigFileTextToJson(this.configFileName, this.fs.readFile(this.configFileName));
                if (jsonConfig.error) {
                    console.error('Cannot parse ' + this.configFileName + ': ' + jsonConfig.error.messageText);
                    return reject(new Error('Cannot parse ' + this.configFileName + ': ' + jsonConfig.error.messageText));
                }
                configObject = jsonConfig.config;
            }
            else {
                configObject = this.configContent;
            }
            let dir = path_.posix.dirname(this.configFileName);
            if (dir == '.') {
                dir = '';
            }
            const base = dir || this.fs.path;
            const configParseResult = ts.parseJsonConfigFileContent(configObject, this.fs, base);
            const expFiles = configParseResult.fileNames;
            // Add globals that might exist in dependencies
            const nodeModulesDir = path_.posix.join(base, "node_modules");
            const err = walkInMemoryFs(this.fs, nodeModulesDir, (path, isdir) => {
                if (!isdir && util.isGlobalTSFile(path)) {
                    expFiles.push(path);
                }
            });
            if (err) {
                return reject(err);
            }
            const options = configParseResult.options;
            if (/(^|\/)jsconfig\.json$/.test(this.configFileName)) {
                options.allowJs = true;
            }
            if (this.traceModuleResolution) {
                options.traceResolution = true;
            }
            this.host = new InMemoryLanguageServiceHost(this.fs.path, options, this.fs, expFiles, this.versions);
            this.service = ts.createLanguageService(this.host, ts.createDocumentRegistry());
            this.program = this.service.getProgram();
            return resolve();
        });
        return this.initialized;
    }
    ensureConfigFile() {
        return this.init();
    }
    ensureBasicFiles() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.ensuredBasicFiles) {
                return this.ensuredBasicFiles;
            }
            this.ensuredBasicFiles = this.init().then(() => {
                let changed = false;
                for (const fileName of (this.getHost().expectedFiles || [])) {
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
        });
    }
    ensureAllFiles() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.ensuredAllFiles) {
                return this.ensuredAllFiles;
            }
            this.ensuredAllFiles = this.init().then(() => {
                if (this.getHost().complete) {
                    return;
                }
                let changed = false;
                for (const fileName of (this.getHost().expectedFiles || [])) {
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
        });
    }
}
exports.ProjectConfiguration = ProjectConfiguration;
exports.skipDir = {
    name: "WALK_FN_SKIP_DIR",
    message: "",
};
var tsLibraries;
/**
 * Fetches TypeScript library files from local file system
 */
function getTypeScriptLibraries() {
    if (!tsLibraries) {
        tsLibraries = new Map();
        const path = path_.dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2015 }));
        fs_.readdirSync(path).forEach((file) => {
            const fullPath = path_.join(path, file);
            if (fs_.statSync(fullPath).isFile()) {
                tsLibraries.set(util.normalizePath(fullPath), fs_.readFileSync(fullPath).toString());
            }
        });
    }
    return tsLibraries;
}
exports.getTypeScriptLibraries = getTypeScriptLibraries;
//# sourceMappingURL=project-manager.js.map