import iterate from 'iterare'
import { noop } from 'lodash'
import { Span } from 'opentracing'
import * as path from 'path'
import { Observable, Subscription } from 'rxjs'
import * as ts from 'typescript'
import { Disposable } from './disposable'
import { FileSystemUpdater } from './fs'
import { Logger, NoopLogger } from './logging'
import { InMemoryFileSystem } from './memfs'
import { PluginCreateInfo, PluginLoader, PluginModuleFactory } from './plugins'
import { PluginSettings } from './request-type'
import { traceObservable, traceSync } from './tracing'
import {
    isConfigFile,
    isDeclarationFile,
    isGlobalTSFile,
    isJSTSFile,
    isPackageJsonFile,
    observableFromIterable,
    path2uri,
    toUnixPath,
    uri2path,
} from './util'

const LAST_FORWARD_OR_BACKWARD_SLASH = /[\\\/][^\\\/]*$/

/**
 * Implementaton of LanguageServiceHost that works with in-memory file system.
 * It takes file content from local cache and provides it to TS compiler on demand
 *
 * @implements ts.LanguageServiceHost
 */
export class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {
    public complete: boolean

    /**
     * Root path
     */
    private rootPath: string

    /**
     * Compiler options to use when parsing/analyzing source files.
     * We are extracting them from tsconfig.json or jsconfig.json
     */
    private options: ts.CompilerOptions

    /**
     * Local file cache where we looking for file content
     */
    private fs: InMemoryFileSystem

    /**
     * Current list of files that were implicitly added to project
     * (every time when we need to extract data from a file that we haven't touched yet).
     * Each item is a relative file path
     */
    private filePaths: string[]

    /**
     * Current project version. When something significant is changed, incrementing it to signal TS compiler that
     * files should be updated and cached data should be invalidated
     */
    private projectVersion: number

    /**
     * Tracks individual files versions to invalidate TS compiler data when single file is changed. Keys are URIs
     */
    private versions: Map<string, number>

    constructor(
        rootPath: string,
        options: ts.CompilerOptions,
        fs: InMemoryFileSystem,
        versions: Map<string, number>,
        private logger: Logger = new NoopLogger()
    ) {
        this.rootPath = rootPath
        this.options = options
        this.fs = fs
        this.versions = versions
        this.projectVersion = 1
        this.filePaths = []
    }

    /**
     * TypeScript uses this method (when present) to compare project's version
     * with the last known one to decide if internal data should be synchronized
     */
    public getProjectVersion(): string {
        return '' + this.projectVersion
    }

    public getNewLine(): string {
        // Although this is optional, language service was sending edits with carriage returns if not specified.
        // TODO: combine with the FormatOptions defaults.
        return '\n'
    }

    /**
     * Incrementing current project version, telling TS compiler to invalidate internal data
     */
    public incProjectVersion(): void {
        this.projectVersion++
    }

    public getCompilationSettings(): ts.CompilerOptions {
        return this.options
    }

    public getScriptFileNames(): string[] {
        return this.filePaths
    }

    /**
     * Adds a file and increments project version, used in conjunction with getProjectVersion()
     * which may be called by TypeScript to check if internal data is up to date
     *
     * @param filePath relative file path
     */
    public addFile(filePath: string): void {
        this.filePaths.push(filePath)
        this.incProjectVersion()
    }

    /**
     * @param fileName absolute file path
     */
    public getScriptVersion(filePath: string): string {
        const uri = path2uri(filePath)
        let version = this.versions.get(uri)
        if (!version) {
            version = 1
            this.versions.set(uri, version)
        }
        return '' + version
    }

    /**
     * @param filePath absolute file path
     */
    public getScriptSnapshot(filePath: string): ts.IScriptSnapshot | undefined {
        const exists = this.fs.fileExists(filePath)
        if (!exists) {
            return undefined
        }
        return ts.ScriptSnapshot.fromString(this.fs.readFile(filePath))
    }

    public getCurrentDirectory(): string {
        return this.rootPath
    }

    public getDefaultLibFileName(options: ts.CompilerOptions): string {
        return toUnixPath(ts.getDefaultLibFilePath(options))
    }

    public trace(message: string): void {
        // empty
    }

    public log(message: string): void {
        // empty
    }

    public error(message: string): void {
        this.logger.error(message)
    }

    public readFile(path: string, encoding?: string): string {
        return this.fs.readFile(path)
    }

    public fileExists(path: string): boolean {
        return this.fs.fileExists(path)
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
 *
 * Windows file paths are converted to UNIX-style forward slashes
 * when compared with Typescript configuration (isGlobalTSFile,
 * expectedFilePaths and typeRoots)
 */
export class ProjectConfiguration {
    private service?: ts.LanguageService

    /**
     * Object TS service will use to fetch content of source files
     */
    private host?: InMemoryLanguageServiceHost

    /**
     * Local file cache
     */
    private fs: InMemoryFileSystem

    /**
     * Relative path to configuration file (tsconfig.json/jsconfig.json)
     */
    public configFilePath: string

    /**
     * Configuration JSON object. May be used when there is no real configuration file to parse and use
     */
    private configContent: any

    /**
     * Relative source file path (relative) -> version associations
     */
    private versions: Map<string, number>

    /**
     * Enables module resolution tracing (done by TS service)
     */
    private traceModuleResolution: boolean

    /**
     * Root file path, relative to workspace hierarchy root
     */
    private rootFilePath: string

    /**
     * List of files that project consist of (based on tsconfig includes/excludes and wildcards).
     * Each item is a relative UNIX-like file path
     */
    private expectedFilePaths = new Set<string>()

    /**
     * List of resolved extra root directories to allow global type declaration files to be loaded from.
     * Each item is an absolute UNIX-like file path
     */
    private typeRoots: string[]

    private initialized = false
    private ensuredAllFiles = false
    private ensuredBasicFiles = false

    /**
     * @param fs file system to use
     * @param documentRegistry Shared DocumentRegistry that manages SourceFile objects
     * @param rootFilePath root file path, absolute
     * @param configFilePath configuration file path, absolute
     * @param configContent optional configuration content to use instead of reading configuration file)
     */
    constructor(
        fs: InMemoryFileSystem,
        private documentRegistry: ts.DocumentRegistry,
        rootFilePath: string,
        versions: Map<string, number>,
        configFilePath: string,
        configContent?: any,
        traceModuleResolution?: boolean,
        private pluginSettings?: PluginSettings,
        private logger: Logger = new NoopLogger()
    ) {
        this.fs = fs
        this.configFilePath = configFilePath
        this.configContent = configContent
        this.versions = versions
        this.traceModuleResolution = traceModuleResolution || false
        this.rootFilePath = rootFilePath
    }

    /**
     * reset resets a ProjectConfiguration to its state immediately
     * after construction. It should be called whenever the underlying
     * local filesystem (fs) has changed, and so the
     * ProjectConfiguration can no longer assume its state reflects
     * that of the underlying files.
     */
    public reset(): void {
        this.initialized = false
        this.ensuredBasicFiles = false
        this.ensuredAllFiles = false
        this.service = undefined
        this.host = undefined
        this.expectedFilePaths = new Set()
    }

    /**
     * @return language service object
     */
    public getService(): ts.LanguageService {
        if (!this.service) {
            throw new Error('project is uninitialized')
        }
        return this.service
    }

    /**
     * Tells TS service to recompile program (if needed) based on current list of files and compilation options.
     * TS service relies on information provided by language servide host to see if there were any changes in
     * the whole project or in some files
     *
     * @return program object (cached result of parsing and typechecking done by TS service)
     */
    public getProgram(childOf = new Span()): ts.Program | undefined {
        return traceSync('Get program', childOf, span => this.getService().getProgram())
    }

    /**
     * @return language service host that TS service uses to read the data
     */
    public getHost(): InMemoryLanguageServiceHost {
        if (!this.host) {
            throw new Error('project is uninitialized')
        }
        return this.host
    }

    /**
     * Initializes (sub)project by parsing configuration and making proper internal objects
     */
    private init(span = new Span()): void {
        if (this.initialized) {
            return
        }
        let configObject
        if (!this.configContent) {
            const jsonConfig = ts.parseConfigFileTextToJson(this.configFilePath, this.fs.readFile(this.configFilePath))
            if (jsonConfig.error) {
                this.logger.error('Cannot parse ' + this.configFilePath + ': ' + jsonConfig.error.messageText)
                throw new Error('Cannot parse ' + this.configFilePath + ': ' + jsonConfig.error.messageText)
            }
            configObject = jsonConfig.config
        } else {
            configObject = this.configContent
        }
        let dir = toUnixPath(this.configFilePath)
        const pos = dir.lastIndexOf('/')
        if (pos <= 0) {
            dir = ''
        } else {
            dir = dir.substring(0, pos)
        }
        const base = dir || this.fs.path
        const configParseResult = ts.parseJsonConfigFileContent(configObject, this.fs, base)
        this.expectedFilePaths = new Set(configParseResult.fileNames)

        const options = configParseResult.options
        const pathResolver = /^[a-z]:\//i.test(base) ? path.win32 : path.posix
        this.typeRoots = options.typeRoots
            ? options.typeRoots.map((r: string) => toUnixPath(pathResolver.resolve(this.rootFilePath, r)))
            : []

        if (/(^|\/)jsconfig\.json$/.test(this.configFilePath)) {
            options.allowJs = true
        }
        if (this.traceModuleResolution) {
            options.traceResolution = true
        }
        this.host = new InMemoryLanguageServiceHost(this.fs.path, options, this.fs, this.versions, this.logger)
        this.service = ts.createLanguageService(this.host, this.documentRegistry)
        const pluginLoader = new PluginLoader(this.rootFilePath, this.fs, this.pluginSettings, this.logger)
        pluginLoader.loadPlugins(options, (factory, config) => this.wrapService(factory, config))
        this.initialized = true
    }

    /**
     * Replaces the LanguageService with an instance wrapped by the plugin
     * @param pluginModuleFactory function to create the module
     * @param configEntry extra settings from tsconfig to pass to the plugin module
     */
    private wrapService(pluginModuleFactory: PluginModuleFactory, configEntry: ts.PluginImport): void {
        try {
            if (typeof pluginModuleFactory !== 'function') {
                this.logger.info(
                    `Skipped loading plugin ${configEntry.name} because it didn't expose a proper factory function`
                )
                return
            }

            const info: PluginCreateInfo = {
                config: configEntry,
                project: {
                    // TODO: may need more support
                    getCurrentDirectory: () => this.getHost().getCurrentDirectory(),
                    projectService: { logger: this.logger },
                },
                languageService: this.getService(),
                languageServiceHost: this.getHost(),
                serverHost: {}, // TODO: may need an adapter
            }

            const pluginModule = pluginModuleFactory({ typescript: ts })
            this.service = pluginModule.create(info)
        } catch (e) {
            this.logger.error(`Plugin activation failed: ${e}`)
        }
    }

    /**
     * Ensures we are ready to process files from a given sub-project
     */
    public ensureConfigFile(span = new Span()): void {
        this.init(span)
    }

    /**
     * Determines if a fileName is a declaration file within expected files or type roots
     * @param fileName A Unix-like absolute file path.
     */
    public isExpectedDeclarationFile(fileName: string): boolean {
        return (
            isDeclarationFile(fileName) &&
            (this.expectedFilePaths.has(fileName) || this.typeRoots.some(root => fileName.startsWith(root)))
        )
    }

    /**
     * Ensures we added basic files (global TS files, dependencies, declarations)
     */
    public ensureBasicFiles(span = new Span()): void {
        if (this.ensuredBasicFiles) {
            return
        }

        this.init(span)

        const program = this.getProgram(span)
        if (!program) {
            return
        }

        // Add all global declaration files from the workspace and all declarations from the project
        for (const uri of this.fs.uris()) {
            const fileName = uri2path(uri)
            const unixPath = toUnixPath(fileName)
            if (isGlobalTSFile(unixPath) || this.isExpectedDeclarationFile(unixPath)) {
                const sourceFile = program.getSourceFile(fileName)
                if (!sourceFile) {
                    this.getHost().addFile(fileName)
                }
            }
        }
        this.ensuredBasicFiles = true
    }

    /**
     * Ensures a single file is available to the LanguageServiceHost
     * @param filePath
     */
    public ensureSourceFile(filePath: string, span = new Span()): void {
        const program = this.getProgram(span)
        if (!program) {
            return
        }
        const sourceFile = program.getSourceFile(filePath)
        if (!sourceFile) {
            this.getHost().addFile(filePath)
        }
    }

    /**
     * Ensures we added all project's source file (as were defined in tsconfig.json)
     */
    public ensureAllFiles(span = new Span()): void {
        if (this.ensuredAllFiles) {
            return
        }
        this.init(span)
        if (this.getHost().complete) {
            return
        }
        const program = this.getProgram(span)
        if (!program) {
            return
        }
        for (const fileName of this.expectedFilePaths) {
            const sourceFile = program.getSourceFile(fileName)
            if (!sourceFile) {
                this.getHost().addFile(fileName)
            }
        }
        this.getHost().complete = true
        this.ensuredAllFiles = true
    }
}

export type ConfigType = 'js' | 'ts'

/**
 * ProjectManager translates VFS files to one or many projects denoted by [tj]config.json.
 * It uses either local or remote file system to fetch directory tree and files from and then
 * makes one or more LanguageService objects. By default all LanguageService objects contain no files,
 * they are added on demand - current file for hover or definition, project's files for references and
 * all files from all projects for workspace symbols.
 *
 * ProjectManager preserves Windows paths until passed to ProjectConfiguration or TS APIs.
 */
export class ProjectManager implements Disposable {
    /**
     * Root path with slashes
     */
    private rootPath: string

    /**
     * (Workspace subtree (folder) -> TS or JS configuration) mapping.
     * Configuration settings for a source file A are located in the closest parent folder of A.
     * Map keys are relative (to workspace root) paths
     */
    private configs = {
        js: new Map<string, ProjectConfiguration>(),
        ts: new Map<string, ProjectConfiguration>(),
    }

    /**
     * Local side of file content provider which keeps cache of fetched files
     */
    private inMemoryFs: InMemoryFileSystem

    /**
     * File system updater that takes care of updating the in-memory file system
     */
    private updater: FileSystemUpdater

    /**
     * URI -> version map. Every time file content is about to change or changed (didChange/didOpen/...), we are incrementing it's version
     * signalling that file is changed and file's user must invalidate cached and requery file content
     */
    private versions: Map<string, number>

    /**
     * Enables module resolution tracing by TS compiler
     */
    private traceModuleResolution: boolean

    /**
     * Flag indicating that we fetched module struture (tsconfig.json, jsconfig.json, package.json files) from the remote file system.
     * Without having this information we won't be able to split workspace to sub-projects
     */
    private ensuredModuleStructure?: Observable<never>

    /**
     * Observable that completes when extra dependencies pointed to by tsconfig.json have been loaded.
     */
    private ensuredConfigDependencies?: Observable<never>

    /**
     * Observable that completes when `ensureAllFiles` completed
     */
    private ensuredAllFiles?: Observable<never>

    /**
     * Observable that completes when `ensureOwnFiles` completed
     */
    private ensuredOwnFiles?: Observable<never>

    /**
     * A URI Map from file to files referenced by the file, so files only need to be pre-processed once
     */
    private referencedFiles = new Map<string, Observable<string>>()

    /**
     * Tracks all Subscriptions that are done in the lifetime of this object to dispose on `dispose()`
     */
    private subscriptions = new Subscription()

    /**
     * Options passed to the language server at startup
     */
    private pluginSettings?: PluginSettings

    /**
     * @param rootPath root path as passed to `initialize`
     * @param inMemoryFileSystem File system that keeps structure and contents in memory
     * @param strict indicates if we are working in strict mode (VFS) or with a local file system
     * @param traceModuleResolution allows to enable module resolution tracing (done by TS compiler)
     */
    constructor(
        rootPath: string,
        inMemoryFileSystem: InMemoryFileSystem,
        updater: FileSystemUpdater,
        traceModuleResolution?: boolean,
        pluginSettings?: PluginSettings,
        protected logger: Logger = new NoopLogger()
    ) {
        this.rootPath = rootPath
        this.updater = updater
        this.inMemoryFs = inMemoryFileSystem
        this.versions = new Map<string, number>()
        this.pluginSettings = pluginSettings
        this.traceModuleResolution = traceModuleResolution || false

        // Share DocumentRegistry between all ProjectConfigurations
        const documentRegistry = ts.createDocumentRegistry()

        // Create catch-all fallback configs in case there are no tsconfig.json files
        // They are removed once at least one tsconfig.json is found
        const trimmedRootPath = this.rootPath.replace(/[\\\/]+$/, '')
        const fallbackConfigs: { js?: ProjectConfiguration; ts?: ProjectConfiguration } = {}
        for (const configType of ['js', 'ts'] as ConfigType[]) {
            const configs = this.configs[configType]
            const tsConfig: any = {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    allowNonTsExtensions: false,
                    allowJs: configType === 'js',
                },
                include: { js: ['**/*.js', '**/*.jsx'], ts: ['**/*.ts', '**/*.tsx'] }[configType],
            }
            const config = new ProjectConfiguration(
                this.inMemoryFs,
                documentRegistry,
                trimmedRootPath,
                this.versions,
                '',
                tsConfig,
                this.traceModuleResolution,
                this.pluginSettings,
                this.logger
            )
            configs.set(trimmedRootPath, config)
            fallbackConfigs[configType] = config
        }

        // Whenever a file with content is added to the InMemoryFileSystem, check if it's a tsconfig.json and add a new ProjectConfiguration
        this.subscriptions.add(
            Observable.fromEvent<[string, string]>(inMemoryFileSystem, 'add', (k, v) => [k, v])
                .filter(
                    ([uri, content]) => !!content && /\/[tj]sconfig\.json/.test(uri) && !uri.includes('/node_modules/')
                )
                .subscribe(([uri, content]) => {
                    const filePath = uri2path(uri)
                    const pos = filePath.search(LAST_FORWARD_OR_BACKWARD_SLASH)
                    const dir = pos <= 0 ? '' : filePath.substring(0, pos)
                    const configType = this.getConfigurationType(filePath)
                    const configs = this.configs[configType]
                    configs.set(
                        dir,
                        new ProjectConfiguration(
                            this.inMemoryFs,
                            documentRegistry,
                            dir,
                            this.versions,
                            filePath,
                            undefined,
                            this.traceModuleResolution,
                            this.pluginSettings,
                            this.logger
                        )
                    )
                    // Remove catch-all config (if exists)
                    if (configs.get(trimmedRootPath) === fallbackConfigs[configType]) {
                        configs.delete(trimmedRootPath)
                    }
                })
        )
    }

    /**
     * Disposes the object (removes all registered listeners)
     */
    public dispose(): void {
        this.subscriptions.unsubscribe()
    }

    /**
     * @return root path (as passed to `initialize`)
     */
    public getRemoteRoot(): string {
        return this.rootPath
    }

    /**
     * @return local side of file content provider which keeps cached copies of fethed files
     */
    public getFs(): InMemoryFileSystem {
        return this.inMemoryFs
    }

    /**
     * @param filePath file path (both absolute or relative file paths are accepted)
     * @return true if there is a fetched file with a given path
     */
    public hasFile(filePath: string): boolean {
        return this.inMemoryFs.fileExists(filePath)
    }

    /**
     * @return all sub-projects we have identified for a given workspace.
     * Sub-project is mainly a folder which contains tsconfig.json, jsconfig.json, package.json,
     * or a root folder which serves as a fallback
     */
    public configurations(): IterableIterator<ProjectConfiguration> {
        return iterate(this.configs.js.values()).concat(this.configs.ts.values())
    }

    /**
     * Ensures that the module structure of the project exists in memory.
     * TypeScript/JavaScript module structure is determined by [jt]sconfig.json,
     * filesystem layout, global*.d.ts and package.json files.
     * Then creates new ProjectConfigurations, resets existing and invalidates file references.
     */
    public ensureModuleStructure(childOf = new Span()): Observable<never> {
        return traceObservable('Ensure module structure', childOf, span => {
            if (!this.ensuredModuleStructure) {
                this.ensuredModuleStructure = this.updater
                    .ensureStructure()
                    // Ensure content of all all global .d.ts, [tj]sconfig.json, package.json files
                    .concat(Observable.defer(() => observableFromIterable(this.inMemoryFs.uris())))
                    .filter(uri => isGlobalTSFile(uri) || isConfigFile(uri) || isPackageJsonFile(uri))
                    .mergeMap(uri => this.updater.ensure(uri))
                    .do(
                        noop,
                        err => {
                            this.ensuredModuleStructure = undefined
                        },
                        () => {
                            // Reset all compilation state
                            // TODO ze incremental compilation instead
                            for (const config of this.configurations()) {
                                config.reset()
                            }
                            // Require re-processing of file references
                            this.invalidateReferencedFiles()
                        }
                    )
                    .publishReplay()
                    .refCount() as Observable<never>
            }
            return this.ensuredModuleStructure
        })
    }

    /**
     * Invalidates caches for `ensureModuleStructure`, `ensureAllFiles` and `insureOwnFiles`
     */
    public invalidateModuleStructure(): void {
        this.ensuredModuleStructure = undefined
        this.ensuredConfigDependencies = undefined
        this.ensuredAllFiles = undefined
        this.ensuredOwnFiles = undefined
    }

    /**
     * Ensures all files not in node_modules were fetched.
     * This includes all js/ts files, tsconfig files and package.json files.
     * Invalidates project configurations after execution
     */
    public ensureOwnFiles(childOf = new Span()): Observable<never> {
        return traceObservable('Ensure own files', childOf, span => {
            if (!this.ensuredOwnFiles) {
                this.ensuredOwnFiles = this.updater
                    .ensureStructure(span)
                    .concat(Observable.defer(() => observableFromIterable(this.inMemoryFs.uris())))
                    .filter(
                        uri =>
                            (!uri.includes('/node_modules/') && isJSTSFile(uri)) ||
                            isConfigFile(uri) ||
                            isPackageJsonFile(uri)
                    )
                    .mergeMap(uri => this.updater.ensure(uri))
                    .do(noop, err => {
                        this.ensuredOwnFiles = undefined
                    })
                    .publishReplay()
                    .refCount() as Observable<never>
            }
            return this.ensuredOwnFiles
        })
    }

    /**
     * Ensures all files were fetched from the remote file system.
     * Invalidates project configurations after execution
     */
    public ensureAllFiles(childOf = new Span()): Observable<never> {
        return traceObservable('Ensure all files', childOf, span => {
            if (!this.ensuredAllFiles) {
                this.ensuredAllFiles = this.updater
                    .ensureStructure(span)
                    .concat(Observable.defer(() => observableFromIterable(this.inMemoryFs.uris())))
                    .filter(uri => isJSTSFile(uri) || isConfigFile(uri) || isPackageJsonFile(uri))
                    .mergeMap(uri => this.updater.ensure(uri))
                    .do(noop, err => {
                        this.ensuredAllFiles = undefined
                    })
                    .publishReplay()
                    .refCount() as Observable<never>
            }
            return this.ensuredAllFiles
        })
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
    public ensureReferencedFiles(
        uri: string,
        maxDepth = 30,
        ignore = new Set<string>(),
        childOf = new Span()
    ): Observable<string> {
        return traceObservable('Ensure referenced files', childOf, span => {
            span.addTags({ uri, maxDepth })
            ignore.add(uri)
            return (
                this.ensureModuleStructure(span)
                    .concat(Observable.defer(() => this.ensureConfigDependencies()))
                    // If max depth was reached, don't go any further
                    .concat(
                        Observable.defer(
                            () => (maxDepth === 0 ? Observable.empty<never>() : this.resolveReferencedFiles(uri))
                        )
                    )
                    // Prevent cycles
                    .filter(referencedUri => !ignore.has(referencedUri))
                    // Call method recursively with one less dep level
                    .mergeMap(referencedUri =>
                        this.ensureReferencedFiles(referencedUri, maxDepth - 1, ignore)
                            // Continue even if an import wasn't found
                            .catch(err => {
                                this.logger.error(`Error resolving file references for ${uri}:`, err)
                                return []
                            })
                    )
            )
        })
    }

    /**
     * Determines if a tsconfig/jsconfig needs additional declaration files loaded.
     * @param filePath A UNIX-like absolute file path
     */
    public isConfigDependency(filePath: string): boolean {
        for (const config of this.configurations()) {
            config.ensureConfigFile()
            if (config.isExpectedDeclarationFile(filePath)) {
                return true
            }
        }
        return false
    }

    /**
     * Loads files determined by tsconfig to be needed into the file system
     */
    public ensureConfigDependencies(childOf = new Span()): Observable<never> {
        return traceObservable('Ensure config dependencies', childOf, span => {
            if (!this.ensuredConfigDependencies) {
                this.ensuredConfigDependencies = observableFromIterable(this.inMemoryFs.uris())
                    .filter(uri => this.isConfigDependency(toUnixPath(uri2path(uri))))
                    .mergeMap(uri => this.updater.ensure(uri))
                    .do(noop, err => {
                        this.ensuredConfigDependencies = undefined
                    })
                    .publishReplay()
                    .refCount() as Observable<never>
            }
            return this.ensuredConfigDependencies
        })
    }

    /**
     * Invalidates a cache entry for `resolveReferencedFiles` (e.g. because the file changed)
     *
     * @param uri The URI that referenced files should be invalidated for. If not given, all entries are invalidated
     */
    public invalidateReferencedFiles(uri?: string): void {
        if (uri) {
            this.referencedFiles.delete(uri)
        } else {
            this.referencedFiles.clear()
        }
    }

    /**
     * Returns the files that are referenced from a given file.
     * If the file has already been processed, returns a cached value.
     *
     * @param uri URI of the file to process
     * @return URIs of files referenced by the file
     */
    private resolveReferencedFiles(uri: string, span = new Span()): Observable<string> {
        let observable = this.referencedFiles.get(uri)
        if (observable) {
            return observable
        }
        observable = this.updater
            .ensure(uri)
            .concat(
                Observable.defer(() => {
                    const referencingFilePath = uri2path(uri)
                    const config = this.getConfiguration(referencingFilePath)
                    config.ensureBasicFiles(span)
                    const contents = this.inMemoryFs.getContent(uri)
                    const info = ts.preProcessFile(contents, true, true)
                    const compilerOpt = config.getHost().getCompilationSettings()
                    const pathResolver = referencingFilePath.includes('\\') ? path.win32 : path.posix
                    // Iterate imported files
                    return Observable.merge(
                        // References with `import`
                        Observable.from(info.importedFiles)
                            .map(importedFile =>
                                ts.resolveModuleName(
                                    importedFile.fileName,
                                    toUnixPath(referencingFilePath),
                                    compilerOpt,
                                    this.inMemoryFs
                                )
                            )
                            // false means we didn't find a file defining the module. It could still
                            // exist as an ambient module, which is why we fetch global*.d.ts files.
                            .filter(resolved => !!(resolved && resolved.resolvedModule))
                            .map(resolved => resolved.resolvedModule!.resolvedFileName),
                        // References with `<reference path="..."/>`
                        Observable.from(info.referencedFiles)
                            // Resolve triple slash references relative to current file instead of using
                            // module resolution host because it behaves differently in "nodejs" mode
                            .map(referencedFile =>
                                pathResolver.resolve(
                                    this.rootPath,
                                    pathResolver.dirname(referencingFilePath),
                                    toUnixPath(referencedFile.fileName)
                                )
                            ),
                        // References with `<reference types="..."/>`
                        Observable.from(info.typeReferenceDirectives)
                            .map(typeReferenceDirective =>
                                ts.resolveTypeReferenceDirective(
                                    typeReferenceDirective.fileName,
                                    referencingFilePath,
                                    compilerOpt,
                                    this.inMemoryFs
                                )
                            )
                            .filter(
                                resolved =>
                                    !!(
                                        resolved &&
                                        resolved.resolvedTypeReferenceDirective &&
                                        resolved.resolvedTypeReferenceDirective.resolvedFileName
                                    )
                            )
                            .map(resolved => resolved.resolvedTypeReferenceDirective!.resolvedFileName!)
                    )
                })
            )
            // Use same scheme, slashes, host for referenced URI as input file
            .map(path2uri)
            // Don't cache errors
            .do(noop, err => {
                this.referencedFiles.delete(uri)
            })
            // Make sure all subscribers get the same values
            .publishReplay()
            .refCount()
        this.referencedFiles.set(uri, observable)
        return observable
    }

    /**
     * @param filePath source file path, absolute
     * @return project configuration for a given source file. Climbs directory tree up to workspace root if needed
     */
    public getConfiguration(
        filePath: string,
        configType: ConfigType = this.getConfigurationType(filePath)
    ): ProjectConfiguration {
        const config = this.getConfigurationIfExists(filePath, configType)
        if (!config) {
            throw new Error(`TypeScript config file for ${filePath} not found`)
        }
        return config
    }

    /**
     * @param filePath source file path, absolute
     * @return closest configuration for a given file path or undefined if there is no such configuration
     */
    public getConfigurationIfExists(
        filePath: string,
        configType = this.getConfigurationType(filePath)
    ): ProjectConfiguration | undefined {
        let dir = filePath
        let config: ProjectConfiguration | undefined
        const configs = this.configs[configType]
        if (!configs) {
            return undefined
        }
        const rootPath = this.rootPath.replace(/[\\\/]+$/, '')
        while (dir && dir !== rootPath) {
            config = configs.get(dir)
            if (config) {
                return config
            }
            const pos = dir.search(LAST_FORWARD_OR_BACKWARD_SLASH)
            if (pos <= 0) {
                dir = ''
            } else {
                dir = dir.substring(0, pos)
            }
        }
        return configs.get(rootPath)
    }

    /**
     * Returns the ProjectConfiguration a file belongs to
     */
    public getParentConfiguration(uri: string, configType?: ConfigType): ProjectConfiguration | undefined {
        return this.getConfigurationIfExists(uri2path(uri), configType)
    }

    /**
     * Returns all ProjectConfigurations contained in the given directory or one of its childrens
     *
     * @param uri URI of a directory
     */
    public getChildConfigurations(uri: string): IterableIterator<ProjectConfiguration> {
        const pathPrefix = uri2path(uri)
        return iterate(this.configs.ts)
            .concat(this.configs.js)
            .filter(([folderPath, config]) => folderPath.startsWith(pathPrefix))
            .map(([folderPath, config]) => config)
    }

    /**
     * Called when file was opened by client. Current implementation
     * does not differenciates open and change events
     * @param uri file's URI
     * @param text file's content
     */
    public didOpen(uri: string, text: string): void {
        this.didChange(uri, text)
    }

    /**
     * Called when file was closed by client. Current implementation invalidates compiled version
     * @param uri file's URI
     */
    public didClose(uri: string, span = new Span()): void {
        const filePath = uri2path(uri)
        this.inMemoryFs.didClose(uri)
        let version = this.versions.get(uri) || 0
        this.versions.set(uri, ++version)
        const config = this.getConfigurationIfExists(filePath)
        if (!config) {
            return
        }
        config.ensureConfigFile(span)
        config.getHost().incProjectVersion()
    }

    /**
     * Called when file was changed by client. Current implementation invalidates compiled version
     * @param uri file's URI
     * @param text file's content
     */
    public didChange(uri: string, text: string, span = new Span()): void {
        const filePath = uri2path(uri)
        this.inMemoryFs.didChange(uri, text)
        let version = this.versions.get(uri) || 0
        this.versions.set(uri, ++version)
        const config = this.getConfigurationIfExists(filePath)
        if (!config) {
            return
        }
        config.ensureConfigFile(span)
        config.ensureSourceFile(filePath)
        config.getHost().incProjectVersion()
    }

    /**
     * Called when file was saved by client
     * @param uri file's URI
     */
    public didSave(uri: string): void {
        this.inMemoryFs.didSave(uri)
    }

    /**
     * @param filePath path to source (or config) file
     * @return configuration type to use for a given file
     */
    private getConfigurationType(filePath: string): ConfigType {
        const unixPath = toUnixPath(filePath)
        const name = path.posix.basename(unixPath)
        if (name === 'tsconfig.json') {
            return 'ts'
        } else if (name === 'jsconfig.json') {
            return 'js'
        }
        const extension = path.posix.extname(unixPath)
        if (extension === '.js' || extension === '.jsx') {
            return 'js'
        }
        return 'ts'
    }
}
