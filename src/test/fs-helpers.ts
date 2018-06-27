import { Span } from 'opentracing'
import { Observable, Subject } from 'rxjs'
import { FileSystem } from '../fs'
import { InMemoryFileSystem } from '../memfs'
import { observableFromIterable } from '../util'

/**
 * Map-based file system that holds map (URI -> content)
 */
export class MapFileSystem extends InMemoryFileSystem implements FileSystem {
    constructor(files: Map<string, string> = new Map()) {
        super(files)
    }

    public getAsyncWorkspaceFiles(base?: string): Observable<string> {
        return Observable.from(observableFromIterable(this.files.keys()))
    }

    public readFile(uri: string): Observable<string> {
        const ret = this.files.get(uri)
        if (ret === undefined) {
            return Observable.throw(new Error(`Attempt to read not-existent file ${uri}`))
        }
        return Observable.of(ret)
    }
}

export class AddFileSystem extends InMemoryFileSystem {
    private fileAdditions = new Subject<string>()
    private filesAdded = this.fileAdditions.publishReplay()
    private remoteFiles: Map<string, string> = new Map()
    constructor() {
        super(new Map())
        this.filesAdded.connect()
    }

    public addRemoteFile(uri: string, content: string): void {
        this.remoteFiles.set(uri, content)
        this.fileAdditions.next(uri)
    }

    public finishAddingFiles(): void {
        this.fileAdditions.complete()
    }

    public readFile(uri: string, childOf?: Span | undefined): Observable<string> {
        return Observable.from([this.remoteFiles.get(uri) as string])
    }

    public getAsyncWorkspaceFiles(base?: string, childOf = new Span()): Observable<string> {
        return this.filesAdded
    }
}
