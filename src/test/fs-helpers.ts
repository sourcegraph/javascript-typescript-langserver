import { Observable } from 'rxjs'
import { FileSystem } from '../fs'
import { observableFromIterable } from '../util'

/**
 * Map-based file system that holds map (URI -> content)
 */
export class MapFileSystem implements FileSystem {
    constructor(private files: Map<string, string>) {}

    public getWorkspaceFiles(base?: string): Observable<string> {
        return observableFromIterable(this.files.keys()).filter(path => !base || path.startsWith(base))
    }

    public getTextDocumentContent(uri: string): Observable<string> {
        const ret = this.files.get(uri)
        if (ret === undefined) {
            return Observable.throw(new Error(`Attempt to read not-existent file ${uri}`))
        }
        return Observable.of(ret)
    }
}
