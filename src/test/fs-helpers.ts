import { iterate } from 'iterare';
import { FileSystem } from '../fs';

/**
 * Map-based file system that holds map (URI -> content)
 */
export class MapFileSystem implements FileSystem {

	constructor(private files: Map<string, string>) { }

	async getWorkspaceFiles(base?: string): Promise<Iterable<string>> {
		return iterate(this.files.keys())
			.filter(path => !base || path.startsWith(base));
	}

	async getTextDocumentContent(uri: string): Promise<string> {
		const ret = this.files.get(uri);
		if (ret === undefined) {
			throw new Error(`Attempt to read not-existent file ${uri}`);
		}
		return ret;
	}
}
