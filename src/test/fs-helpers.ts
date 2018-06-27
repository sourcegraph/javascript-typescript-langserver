import { Observable, } from 'rxjs'
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
