import * as fs from 'mz/fs'
import { Span } from 'opentracing'
import * as path from 'path'
import { Observable } from 'rxjs'
import Semaphore from 'semaphore-async-await'
import { LanguageClient } from './lang-handler'
import { FileSystemEntries } from './match-files'
import { InMemoryFileSystem } from './memfs'
import { traceObservable } from './tracing'
import { normalizeUri, uri2path } from './util'

export interface FileSystem {
    /**
     * Returns files in the workspace under base that cannot be fetched synchronously, such as remote files.
     *
     * @param base A URI under which to search, resolved relative to the rootUri
     * @return An Observable that emits URIs
     */
    getAsyncWorkspaceFiles(base?: string, childOf?: Span): Observable<string>

    /**
     * Returns the content of a text document
     *
     * @param uri The URI of the text document, resolved relative to the rootUri
     * @return An Observable that emits the text document content
     */
    readFile(uri: string, childOf?: Span): Observable<string>

    /**
     * Returns all URIs known to exist in the workspace that have not yet been made available synchronously.
     */
    knownUrisWithoutAvailableContent(): IterableIterator<string>

    /**
     * Returns true if the given file is known to exist in the workspace (content loaded or not)
     *
     * @param uri URI to a file
     */
    has(uri: string): boolean

    /**
     * Returns the file content for the given URI, if that file is synchronously available.
     */
    readFileIfAvailable(uri: string): string | undefined

    /**
     * Make sure a file is available synchronously. If the file was already available synchronously, such as for a local file system, then nothing has to be done.
     *
     * @param uri The URI of the file
     * @param content The optional content
     */
    makeFileAvailableSynchronously(uri: string, content?: string): void

    /**
     * Return the files and directories inside of the given directory
     */
    getFileSystemEntries(directory: string): FileSystemEntries
}

export class RemoteFileSystem extends InMemoryFileSystem implements FileSystem {
    constructor(private client: LanguageClient) {
        super(new Map<string, string | undefined>())
    }

    /**
     * The files request is sent from the server to the client to request a list of all files in the workspace or inside the directory of the base parameter, if given.
     * A language server can use the result to index files by filtering and doing a content request for each text document of interest.
     */
    public getAsyncWorkspaceFiles(base?: string, childOf = new Span()): Observable<string> {
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
    public readFile(uri: string, childOf = new Span()): Observable<string> {
        return this.client
            .textDocumentXcontent({ textDocument: { uri } }, childOf)
            .map(textDocument => textDocument.text)
    }
}

export class LocalFileSystem implements FileSystem {
    /**
     * @param rootUri The root URI that is used if `base` is not specified
     */
    constructor(private rootUri: string) {}

    public getAsyncWorkspaceFiles(base = this.rootUri): Observable<string> {
        return Observable.empty()
    }

    public readFile(uri: string): Observable<string> {
        return Observable.fromPromise(fs.readFile(uri2path(uri), 'utf8'))
    }

    /**
     * Returns an IterableIterator for all URIs known to exist in the workspace (content loaded or not)
     */
    public *knownUrisWithoutAvailableContent(): IterableIterator<string> {
        // no-op
    }

    /**
     * Returns true if the given file is known to exist in the workspace (content loaded or not)
     * @param uri URI to a file
     */
    public has(uri: string): boolean {
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

    public makeFileAvailableSynchronously(uri: string, content?: string): void {
        // no-op
    }

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
 * Synchronizes a remote file system to an in-memory file system
 *
 * TODO: Implement Disposable with Disposer
 */
export class FileSystemUpdater {
    /**
     * Observable for a pending or completed structure fetch
     */
    private structureFetch?: Observable<never>

    /**
     * Map from URI to Observable of pending or completed content fetch
     */
    private fetches = new Map<string, Observable<never>>()

    /**
     * Limits concurrent fetches to not fetch thousands of files in parallel
     */
    private concurrencyLimit = new Semaphore(100)

    constructor(private fileSystem: FileSystem) {}

    /**
     * Fetches the file content for the given URI and adds the content to the in-memory file system
     *
     * @param uri URI of the file to fetch
     * @param childOf A parent span for tracing
     * @return Observable that completes when the fetch is finished
     */
    public fetch(uri: string, childOf = new Span()): Observable<never> {
        // Limit concurrent fetches
        const observable = Observable.fromPromise(this.concurrencyLimit.wait())
            .mergeMap(() => this.fileSystem.readFile(uri))
            .do(
                content => {
                    this.concurrencyLimit.signal()
                    this.fileSystem.makeFileAvailableSynchronously(uri, content)
                },
                err => {
                    this.fetches.delete(uri)
                }
            )
            .ignoreElements()
            .publishReplay()
            .refCount() as Observable<never>
        this.fetches.set(uri, observable)
        return observable
    }

    /**
     * Returns a promise that is resolved when the given URI has been fetched (at least once) to the in-memory file system.
     * This function cannot be cancelled because multiple callers readFileIfAvailable the result of the same operation.
     *
     * @param uri URI of the file to ensure
     * @param childOf An OpenTracing span for tracing
     * @return Observable that completes when the file was fetched
     */
    public ensure(uri: string, childOf = new Span()): Observable<never> {
        return traceObservable('Ensure content', childOf, span => {
            span.addTags({ uri })
            return this.fetches.get(uri) || this.fetch(uri, span)
        })
    }

    /**
     * Fetches the file/directory structure for the given directory from the remote file system and saves it in the in-memory file system
     *
     * @param childOf A parent span for tracing
     */
    public fetchStructure(childOf = new Span()): Observable<never> {
        const observable = traceObservable(
            'Fetch workspace structure',
            childOf,
            span =>
                this.fileSystem
                    .getAsyncWorkspaceFiles(undefined, span)
                    .do(
                        uri => {
                            this.fileSystem.makeFileAvailableSynchronously(uri)
                        },
                        err => {
                            this.structureFetch = undefined
                        }
                    )
                    .ignoreElements()
                    .publishReplay()
                    .refCount() as Observable<never>
        )
        this.structureFetch = observable
        return observable
    }

    /**
     * Returns a promise that is resolved as soon as the file/directory structure for the given directory has been synced
     * from the remote file system to the in-memory file system (at least once)
     *
     * @param span An OpenTracing span for tracing
     */
    public ensureStructure(childOf = new Span()): Observable<never> {
        return traceObservable('Ensure structure', childOf, span => this.structureFetch || this.fetchStructure(span))
    }

    /**
     * Invalidates the content fetch cache of a file.
     * The next call to `ensure` will do a refetch.
     *
     * @param uri URI of the file that changed
     */
    public invalidate(uri: string): void {
        this.fetches.delete(uri)
    }

    /**
     * Invalidates the structure fetch cache.
     * The next call to `ensureStructure` will do a refetch.
     */
    public invalidateStructure(): void {
        this.structureFetch = undefined
    }
}
