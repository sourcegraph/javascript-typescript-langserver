import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'
import { InMemoryFileSystem, SynchronousFileSystem } from './fs'
import { Logger, NoopLogger } from './logging'
import { FileSystemEntries, matchFiles } from './match-files'
import { path2uri, toUnixPath, uri2path } from './util'

/**
 * TypeScript library files fetched from the local file system (bundled TS)
 */
export const typeScriptLibraries: Map<string, string> = new Map<string, string>()

/**
 * Overlay a in-memory list of files on top of an existing file system. Useful for storing file state for files that are being editted. Can be served as a ParseConfigHost (thus allowing listing files that belong to project based on tsconfig.json options)
 */
export class OverlayFileSystem extends EventEmitter implements ts.ParseConfigHost, ts.ModuleResolutionHost {
    /**
     * Map (URI -> string content) of temporary files made while user modifies local file(s)
     */
    public overlay: Map<string, string>

    /**
     * Should we take into account register when performing a file name match or not. On Windows when using local file system, file names are case-insensitive
     */
    public useCaseSensitiveFileNames: boolean

    /**
     * Root path
     */
    public path: string

    constructor(readonly fileSystem: SynchronousFileSystem, path: string, private logger: Logger = new NoopLogger()) {
        super()
        this.path = path
        this.overlay = new Map<string, string>()
    }

    /**
     * Tells if a file denoted by the given name exists in the workspace (does not have to be loaded)
     *
     * @param path File path or URI (both absolute or relative file paths are accepted)
     */
    public fileExists(path: string): boolean {
        const uri = path2uri(path)
        return this.overlay.has(uri) || this.fileSystem.fileExists(uri) || typeScriptLibraries.has(path)
    }

    /**
     * @param path file path (both absolute or relative file paths are accepted)
     * @return file's content in the following order (overlay then cache).
     * If there is no such file, returns empty string to match expected signature
     */
    public readFile(path: string): string {
        const content = this.readFileIfExists(path)
        if (content === undefined) {
            this.logger.warn(`readFile ${path} requested by TypeScript but content not available`)
            return ''
        }
        return content
    }

    /**
     * @param path file path (both absolute or relative file paths are accepted)
     * @return file's content in the following order (overlay then cache).
     * If there is no such file, returns undefined
     */
    public readFileIfExists(path: string): string | undefined {
        const uri = path2uri(path)
        let content = this.overlay.get(uri)
        if (content !== undefined) {
            return content
        }

        // TODO This assumes that the URI was a file:// URL.
        //      In reality it could be anything, and the first URI matching the path should be used.
        //      With the current Map, the search would be O(n), it would require a tree to get O(log(n))
        content = this.fileSystem.readFileIfAvailable(uri)
        if (content !== undefined) {
            return content
        }

        return typeScriptLibraries.get(path)
    }

    /**
     * Returns the file content for the given URI.
     * Will throw an Error if no available in-memory.
     * Use FileSystemUpdater.ensure() to ensure that the file is available.
     */
    public getContent(uri: string): string {
        const content = this.readFileIfExists(uri2path(uri))
        if (content === undefined) {
            throw new Error(`Content of ${uri} is not available in memory`)
        }
        return content
    }

    /**
     * Invalidates temporary content denoted by the given URI
     * @param uri file's URI
     */
    public didClose(uri: string): void {
        this.overlay.delete(uri)
    }

    /**
     * Adds temporary content denoted by the given URI
     * @param uri file's URI
     */
    public didSave(uri: string): void {
        const content = this.overlay.get(uri)
        if (content !== undefined && this.fileSystem instanceof InMemoryFileSystem) {
            this.fileSystem.add(uri, content)
        }
    }

    /**
     * Updates temporary content denoted by the given URI
     * @param uri file's URI
     */
    public didChange(uri: string, text: string): void {
        this.overlay.set(uri, text)
    }

    /**
     * Called by TS service to scan virtual directory when TS service looks for source files that belong to a project
     */
    public readDirectory(
        rootDir: string,
        extensions: ReadonlyArray<string> | undefined,
        excludes: ReadonlyArray<string> | undefined,
        includes: ReadonlyArray<string>
    ): string[] {
        return matchFiles(rootDir, extensions, excludes, includes, true, this.path, p =>
            this.fileSystem.getFileSystemEntries(p)
        )
    }

    /**
     * Return the files and directories contained in the given directory
     */
    public getFileSystemEntries(path: string): FileSystemEntries {
        return this.fileSystem.getFileSystemEntries(path)
    }

    public trace(message: string): void {
        this.logger.log(message)
    }
}

/**
 * Fetching TypeScript library files from local file system
 */
const libPath = path.dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2015 }))
for (const file of fs.readdirSync(libPath)) {
    const fullPath = path.join(libPath, file)
    if (fs.statSync(fullPath).isFile()) {
        typeScriptLibraries.set(toUnixPath(fullPath), fs.readFileSync(fullPath).toString())
    }
}

/**
 * @param path file path
 * @return true if given file belongs to bundled TypeScript libraries
 */
export function isTypeScriptLibrary(path: string): boolean {
    return typeScriptLibraries.has(toUnixPath(path))
}
