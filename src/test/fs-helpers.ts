import { Observable } from 'rxjs'
import { AsynchronousFileSystem } from '../fs'
import { observableFromIterable } from '../util'

/**
 * Map-based file system that holds map (URI -> content). Useful for testing.
 */
export class MapAsynchronousFileSystem implements AsynchronousFileSystem {
    constructor(readonly asyncFiles: Map<string, string> = new Map()) {}

    public getWorkspaceFiles(base?: string): Observable<string> {
        return observableFromIterable(this.asyncFiles.keys())
    }

    public getTextDocumentContent(uri: string): Observable<string> {
        const ret = this.asyncFiles.get(uri)
        if (ret === undefined) {
            return Observable.throw(new Error(`Attempt to read not-existent file ${uri}`))
        }
        return Observable.of(ret)
    }
}
