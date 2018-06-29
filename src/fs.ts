import * as fs from 'mz/fs'
import { Span } from 'opentracing'
import * as path from 'path'
import { Observable } from 'rxjs'
import { LanguageClient } from './lang-handler'
import { FileSystemEntries } from './match-files'
import { normalizeUri, uri2path } from './util'

/**
 * Provides a synchronous file system API.
 */
export interface SynchronousFileSystem {
    /**
     * Returns true if the given file is known to exist in the workspace (content loaded or not)
     *
     * @param uri URI to a file
     */
    fileExists(uri: string): boolean

    /**
     * Returns the file content for the given URI, if that file is synchronously available.
     */
    readFileIfAvailable(uri: string): string | undefined

    /**
     * Return the files and directories contained in the given directory
     */
    getFileSystemEntries(directory: string): FileSystemEntries
}

/**
 * In-memory file cache node which represents either a folder or a file
 */
export interface FileSystemNode {
    file: boolean
    children: Map<string, FileSystemNode>
}

/**
 * In-memory file system
 */
export class InMemoryFileSystem implements SynchronousFileSystem {
    /**
     * File tree root
     */
    public rootNode: FileSystemNode = { file: false, children: new Map<string, FileSystemNode>() }

    /**
     * Contains a Map of all URIs that exist in the workspace, optionally with a content.
     * File contents for URIs in it do not neccessarily have to be fetched already.
     */
    constructor(private readonly files: Map<string, string | undefined> = new Map()) {}

    /**
     * Return all known uri's in the workspace. (content loaded or not)
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
    }

    /**
     * Return the files and directories contained in the given directory
     */
    public getFileSystemEntries(directory: string): FileSystemEntries {
        const ret: { files: string[]; directories: string[] } = { files: [], directories: [] }
        let node = this.rootNode
        const components = directory.split(/[\\\/]/).filter(c => c)
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

    /**
     * Returns true if the given file is known to exist in the workspace (content loaded or not)
     *
     * @param uri URI to a file
     */
    public fileExists(uri: string): boolean {
        return this.files.has(uri)
    }

    /**
     * Returns the file content for the given URI.
     */
    public readFileIfAvailable(uri: string): string | undefined {
        return this.files.get(uri)
    }
}

export class LocalFileSystem implements SynchronousFileSystem {

    /**
     * Returns true if the given file is known to exist in the workspace (content loaded or not)
     * @param uri URI to a file
     */
    public fileExists(uri: string): boolean {
        return fs.existsSync(uri2path(uri))
    }

    /**
     * Returns the file content for the given URI.
     */
    public readFileIfAvailable(uri: string): string | undefined {
        try {
            return fs.readFileSync(uri2path(uri), 'utf8')
        } catch (e) {
            return undefined
        }
    }

    /**
     * Return the files and directories contained in the given directory
     */
    public getFileSystemEntries(directory: string): FileSystemEntries {
        const files: string[] = []
        const directories: string[] = []
        for (const name of fs.readdirSync(directory)) {
            const filePath = path.join(directory, name)
            const stat = fs.statSync(filePath)
            if (stat.isFile()) {
                files.push(name)
            } else if (stat.isDirectory()) {
                directories.push(name)
            }
        }
        return { files, directories }
    }
}

/**
 * Provides a minimal asynchronous file system API.
 */
export interface AsynchronousFileSystem {
    /**
     * Returns all files in the workspace under base
     *
     * @param base A URI under which to search, resolved relative to the rootUri
     * @return An Observable that emits URIs
     */
    getWorkspaceFiles(base?: string | undefined, childOf?: Span | undefined): Observable<string>

    /**
     * Returns the content of a text document
     *
     * @param uri The URI of the text document, resolved relative to the rootUri
     * @return An Observable that emits the text document content
     */
    getTextDocumentContent(uri: string, childOf?: Span | undefined): Observable<string>
}

export class RemoteFileSystem implements AsynchronousFileSystem {
    constructor(private client: LanguageClient) {}

    /**
     * The files request is sent from the server to the client to request a list of all files in the workspace or inside the directory of the base parameter, if given.
     * A language server can use the result to index files by filtering and doing a content request for each text document of interest.
     */
    public getWorkspaceFiles(base?: string, childOf = new Span()): Observable<string> {
        return this.client
            .workspaceXfiles({ base }, childOf)
            .mergeMap(textDocuments => textDocuments)
            .map(textDocument => normalizeUri(textDocument.uri))
    }

    /**
     * The content request is sent from the server to the client to request the current content of
     * any text document. This allows language servers to operate without accessing the file system
     * directly.
     */
    public getTextDocumentContent(uri: string, childOf = new Span()): Observable<string> {
        return this.client
            .textDocumentXcontent({ textDocument: { uri } }, childOf)
            .map(textDocument => textDocument.text)
    }
}
