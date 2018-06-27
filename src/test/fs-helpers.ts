import { Observable } from 'rxjs'
import { FileSystem } from '../fs'
import { InMemoryFileSystem } from '../memfs'
import { observableFromIterable } from '../util'

/**
 * Map-based file system that holds map (URI -> content)
 */
export class MockRemoteFileSystem extends InMemoryFileSystem implements FileSystem {
    constructor(readonly asyncFiles: Map<string, string> = new Map()) {
        super(new Map())
    }

    public getAsyncWorkspaceFiles(base?: string): Observable<string> {
        return observableFromIterable(this.asyncFiles.keys())
    }

    public readFile(uri: string): Observable<string> {
        const ret = this.asyncFiles.get(uri)
        if (ret === undefined) {
            return Observable.throw(new Error(`Attempt to read not-existent file ${uri}`))
        }
        return Observable.of(ret)
    }
}
