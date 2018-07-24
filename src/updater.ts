import { Span } from 'opentracing'
import { Observable } from 'rxjs'
import Semaphore from 'semaphore-async-await/dist/Semaphore'
import { AsynchronousFileSystem, InMemoryFileSystem } from './fs'
import { traceObservable } from './tracing'

export interface FileSystemUpdater {
    knownUrisWithoutAvailableContent(): IterableIterator<string>
    ensure(uri: string, childOf?: Span): Observable<never>
    ensureStructure(childOf?: Span): Observable<never>
}

export class NoopFileSystemUpdater implements FileSystemUpdater {
    public *knownUrisWithoutAvailableContent(): IterableIterator<string> {
        // no-op
    }

    public ensure(uri: string, childOf?: Span | undefined): Observable<never> {
        return Observable.empty()
    }

    public ensureStructure(childOf?: Span | undefined): Observable<never> {
        return Observable.empty()
    }
}

/**
 * Synchronizes a remote file system to an in-memory file system
 *
 * TODO: Implement Disposable with Disposer
 */
export class RemoteFileSystemUpdater implements FileSystemUpdater {
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

    constructor(readonly remoteFileSystem: AsynchronousFileSystem, readonly fileSystem: InMemoryFileSystem) {}

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
            .mergeMap(() => this.remoteFileSystem.getTextDocumentContent(uri))
            .do(
                content => {
                    this.concurrencyLimit.signal()
                    this.fileSystem.add(uri, content)
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
     * This function cannot be cancelled because multiple callers get the result of the same operation.
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
                this.remoteFileSystem
                    .getWorkspaceFiles(undefined, span)
                    .do(
                        uri => {
                            this.fileSystem.add(uri)
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

    /**
     * Returns an IterableIterator for all URIs known to exist in the workspace whose content is not synchronously available.
     */
    public *knownUrisWithoutAvailableContent(): IterableIterator<string> {
        for (const file of this.fileSystem.uris()) {
            if (!this.fileSystem.readFileIfAvailable(file)) {
                yield file
            }
        }
    }
}
