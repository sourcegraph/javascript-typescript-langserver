import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'
import { Logger, NoopLogger } from './logging'
import { FileSystemEntries, matchFiles } from './match-files'
import { path2uri, toUnixPath, uri2path } from './util'

/**
 * TypeScript library files fetched from the local file system (bundled TS)
 */
export const typeScriptLibraries: Map<string, string> = new Map<string, string>()

/**
 * In-memory file cache node which represents either a folder or a file
 */
export interface FileSystemNode {
    file: boolean
    children: Map<string, FileSystemNode>
}

/**
 * In-memory file system, can be served as a ParseConfigHost (thus allowing listing files that belong to project based on tsconfig.json options)
 */
export class InMemoryFileSystem extends EventEmitter implements ts.ParseConfigHost, ts.ModuleResolutionHost {
    /**
     * Contains a Map of all URIs that exist in the workspace, optionally with a content.
     * File contents for URIs in it do not neccessarily have to be fetched already.
     */
    private files = new Map<string, string | undefined>()

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

    /**
     * File tree root
     */
    public rootNode: FileSystemNode

    constructor(path: string, private logger: Logger = new NoopLogger()) {
        super()
        this.path = path
        this.overlay = new Map<string, string>()
        this.rootNode = { file: false, children: new Map<string, FileSystemNode>() }
    }

    /** Emitted when a file was added */
    public on(event: 'add', listener: (uri: string, content?: string) => void): this {
        return super.on(event, listener)
    }

    /**
     * Returns an IterableIterator for all URIs known to exist in the workspace (content loaded or not)
     */
    public uris(): IterableIterator<string> {
        return this.files.keys()
    }

    /**
     * Adds a file to the local cache
     *
     * @param uri The URI of the file
     * @param content The optional content
     */
    public add(uri: string, content?: string): void {
        // Make sure not to override existing content with undefined
        if (content !== undefined || !this.files.has(uri)) {
            this.files.set(uri, content)
        }
        // Add to directory tree
        // TODO: convert this to use URIs.
        const filePath = uri2path(uri)
        const components = filePath.split(/[\/\\]/).filter(c => c)
        let node = this.rootNode
        for (const [i, component] of components.entries()) {
            const n = node.children.get(component)
            if (!n) {
                if (i < components.length - 1) {
                    const n = { file: false, children: new Map<string, FileSystemNode>() }
                    node.children.set(component, n)
                    node = n
                } else {
                    node.children.set(component, { file: true, children: new Map<string, FileSystemNode>() })
                }
            } else {
                node = n
            }
        }
        this.emit('add', uri, content)
    }

    /**
     * Returns true if the given file is known to exist in the workspace (content loaded or not)
     *
     * @param uri URI to a file
     */
    public has(uri: string): boolean {
        return this.files.has(uri) || this.fileExists(uri2path(uri))
    }

    /**
     * Returns the file content for the given URI.
     * Will throw an Error if no available in-memory.
     * Use FileSystemUpdater.ensure() to ensure that the file is available.
     */
    public getContent(uri: string): string {
        let content = this.overlay.get(uri)
        if (content === undefined) {
            content = this.files.get(uri)
        }
        if (content === undefined) {
            content = typeScriptLibraries.get(uri2path(uri))
        }
        if (content === undefined) {
            throw new Error(`Content of ${uri} is not available in memory`)
        }
        return content
    }

    /**
     * Tells if a file denoted by the given name exists in the workspace (does not have to be loaded)
     *
     * @param path File path or URI (both absolute or relative file paths are accepted)
     */
    public fileExists(path: string): boolean {
        const uri = path2uri(path)
        return this.overlay.has(uri) || this.files.has(uri) || typeScriptLibraries.has(path)
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
    private readFileIfExists(path: string): string | undefined {
        const uri = path2uri(path)
        let content = this.overlay.get(uri)
        if (content !== undefined) {
            return content
        }

        // TODO This assumes that the URI was a file:// URL.
        //      In reality it could be anything, and the first URI matching the path should be used.
        //      With the current Map, the search would be O(n), it would require a tree to get O(log(n))
        content = this.files.get(uri)
        if (content !== undefined) {
            return content
        }

        return typeScriptLibraries.get(path)
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
        if (content !== undefined) {
            this.add(uri, content)
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
    public readDirectory(rootDir: string, extensions: string[], excludes: string[], includes: string[]): string[] {
        return matchFiles(rootDir, extensions, excludes, includes, true, this.path, p => this.getFileSystemEntries(p))
    }

    /**
     * Called by TS service to scan virtual directory when TS service looks for source files that belong to a project
     */
    public getFileSystemEntries(path: string): FileSystemEntries {
        const ret: { files: string[]; directories: string[] } = { files: [], directories: [] }
        let node = this.rootNode
        const components = path.split('/').filter(c => c)
        if (components.length !== 1 || components[0]) {
            for (const component of components) {
                const n = node.children.get(component)
                if (!n) {
                    return ret
                }
                node = n
            }
        }
        for (const [name, value] of node.children.entries()) {
            if (value.file) {
                ret.files.push(name)
            } else {
                ret.directories.push(name)
            }
        }
        return ret
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
