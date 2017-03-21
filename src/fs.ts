import * as fs from 'mz/fs';
import * as path from 'path';
import { cancellableMemoize, CancellationToken, throwIfRequested } from './cancellation';
import { LanguageClientHandler } from './lang-handler';
import glob = require('glob');
import Semaphore from 'semaphore-async-await';
import * as url from 'url';
import { InMemoryFileSystem } from './project-manager';
import { path2uri, uri2path } from './util';

export interface FileSystem {
	/**
	 * Returns all files in the workspace under base
	 *
	 * @param base A URI under which to search, resolved relative to the rootUri
	 * @return A promise that is fulfilled with an array of URIs
	 */
	getWorkspaceFiles(base?: string, token?: CancellationToken): Promise<string[]>;

	/**
	 * Returns the content of a text document
	 *
	 * @param uri The URI of the text document, resolved relative to the rootUri
	 * @return A promise that is fulfilled with the text document content
	 */
	getTextDocumentContent(uri: string, token?: CancellationToken): Promise<string>;
}

export class RemoteFileSystem implements FileSystem {

	constructor(private client: LanguageClientHandler) {}

	/**
	 * The files request is sent from the server to the client to request a list of all files in the workspace or inside the directory of the base parameter, if given.
	 * A language server can use the result to index files by filtering and doing a content request for each text document of interest.
	 */
	async getWorkspaceFiles(base?: string, token = CancellationToken.None): Promise<string[]> {
		const textDocuments = await this.client.getWorkspaceFiles({ base }, token);
		return textDocuments.map(textDocument => textDocument.uri);
	}

	/**
	 * The content request is sent from the server to the client to request the current content of any text document. This allows language servers to operate without accessing the file system directly.
	 */
	async getTextDocumentContent(uri: string, token = CancellationToken.None): Promise<string> {
		const textDocument = await this.client.getTextDocumentContent({ textDocument: { uri } }, token);
		return textDocument.text;
	}
}

export class LocalFileSystem implements FileSystem {

	/**
	 * @param rootPath The root directory path that relative URIs should be resolved to
	 */
	constructor(private rootPath: string) {}

	/**
	 * Converts the URI to an absolute path
	 */
	protected resolveUriToPath(uri: string): string {
		return path.resolve(this.rootPath, uri2path(uri));
	}

	async getWorkspaceFiles(base?: string): Promise<string[]> {
		const pattern = base ? path.posix.join(this.resolveUriToPath(base), '**/*.*') : this.resolveUriToPath('file:///**/*.*');
		const files = await new Promise<string[]>((resolve, reject) => {
			glob(pattern, { nodir: true }, (err, matches) => err ? reject(err) : resolve(matches));
		});
		return files.map(file => path2uri('', file));
	}

	async getTextDocumentContent(uri: string): Promise<string> {
		return fs.readFile(this.resolveUriToPath(uri), 'utf8');
	}
}

/**
 * Memoization cache that saves URIs and searches parent directories too
 */
class ParentUriMemoizationCache extends Map<string | undefined, Promise<void>> {

	/**
	 * Returns the value if the given URI or a parent directory of the URI is in the cache
	 */
	get(uri: string | undefined): Promise<void> | undefined {
		let hit = super.get(uri);
		if (hit) {
			return hit;
		}
		// Find out if parent folder is being fetched already
		hit = super.get(undefined);
		if (hit) {
			return hit;
		}
		if (uri) {
			for (let parts = url.parse(uri); parts.pathname && parts.pathname !== '/'; parts.pathname = path.dirname(parts.pathname)) {
				hit = super.get(url.format(parts));
				if (hit) {
					return hit;
				}
			}
		}
		return undefined;
	}

	/**
	 * Returns true if the given URI or a parent directory of the URI is in the cache
	 */
	has(key: string): boolean {
		return this.get(key) !== undefined;
	}
}

/**
 * Synchronizes a remote file system to an in-memory file system
 *
 * TODO: Implement Disposable with Disposer
 */
export class FileSystemUpdater {

	/**
	 * Limits concurrent fetches to not fetch thousands of files in parallel
	 */
	private concurrencyLimit = new Semaphore(100);

	constructor(private remoteFs: FileSystem, private inMemoryFs: InMemoryFileSystem) {}

	/**
	 * Fetches the file content for the given URI and adds the content to the in-memory file system
	 *
	 * @param uri URI of the file to fetch
	 */
	fetch(uri: string, token = CancellationToken.None): Promise<void> {
		// Limit concurrent fetches
		return this.concurrencyLimit.execute(async () => {
			throwIfRequested(token);
			const content = await this.remoteFs.getTextDocumentContent(uri, token);
			this.inMemoryFs.add(uri, content);
		});
	}

	/**
	 * Returns a promise that is resolved when the given URI has been fetched (at least once) to the in-memory file system.
	 * This function cannot be cancelled because multiple callers get the result of the same operation.
	 *
	 * @param uri URI of the file to ensure
	 */
	ensure = cancellableMemoize(this.fetch);

	/**
	 * Fetches the file/directory structure for the given directory from the remote file system and saves it in the in-memory file system
	 *
	 * @param base The base directory which structure will be synced. Defaults to the workspace root
	 */
	async fetchStructure(base?: string, token = CancellationToken.None): Promise<void> {
		const uris = await this.remoteFs.getWorkspaceFiles(base, token);
		for (const uri of uris) {
			this.inMemoryFs.add(uri);
		}
	}

	/**
	 * Returns a promise that is resolved as soon as the file/directory structure for the given directory has been synced
	 * from the remote file system to the in-memory file system (at least once)
	 */
	ensureStructure = cancellableMemoize(this.fetchStructure, new ParentUriMemoizationCache());
}
