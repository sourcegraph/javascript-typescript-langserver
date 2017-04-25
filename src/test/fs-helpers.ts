import { iterate } from 'iterare';
import { URL } from 'whatwg-url';
import { FileSystem } from '../fs';

/**
 * Map-based file system that holds map (URI -> content)
 */
export class MapFileSystem implements FileSystem {

	constructor(private files: Map<string, string>) { }

	async getWorkspaceFiles(base?: URL): Promise<Iterable<URL>> {
		return iterate(this.files.keys())
			.filter(uri => !base || uri.startsWith(base.href))
			.map(uri => new URL(uri));
	}

	async getTextDocumentContent(uri: URL): Promise<string> {
		const ret = this.files.get(uri.href);
		if (ret === undefined) {
			throw new Error(`Attempt to read not-existent file ${uri}`);
		}
		return ret;
	}
}
