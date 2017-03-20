import * as fs from 'mz/fs';
import * as path from 'path';
import { CancellationToken, throwIfRequested } from './cancellation';
import { LanguageClientHandler } from './lang-handler';
import glob = require('glob');
import Semaphore from 'semaphore-async-await';
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
 * Synchronizes a remote file system to an in-memory file system
 *
 * TODO: Implement Disposable with Disposer
 */
export class FileSystemUpdater {

	/**
	 * Map from URI to Promise for a content fetch
	 */
	private fetches = new Map<string, Promise<void>>();

	/**
	 * Limits concurrent fetches to not fetch thousands of files in parallel
	 */
	private concurrencyLimit = new Semaphore(100);

	private structureFetch?: Promise<void>;

	constructor(private remoteFs: FileSystem, private inMemoryFs: InMemoryFileSystem) {}

	/**
	 * Fetches the file content for the given URI and adds the content to the in-memory file system
	 *
	 * @param uri URI of the file to fetch
	 */
	async fetch(uri: string, token = CancellationToken.None): Promise<void> {
		// Limit concurrent fetches
		const fetch = this.concurrencyLimit.execute(async () => {
			throwIfRequested(token);
			const content = await this.remoteFs.getTextDocumentContent(uri, token);
			this.inMemoryFs.addFile(uri2path(uri), content);
		});
		// Avoid unhandled promise rejection errors (error is still propagated)
		fetch.catch(err => {
			// Don't cache failed or cancelled fetches
			this.fetches.delete(uri);
		});
		// Track the fetch
		this.fetches.set(uri, fetch);
		return fetch;
	}

	/**
	 * Returns a promise that is resolved when the given URI has been fetched (at least once) to the in-memory file system.
	 * This function cannot be cancelled because multiple callers get the result of the same operation.
	 *
	 * TODO use memoize helper and support cancellation with multiple consumers
	 *
	 * @param uri URI of the file to ensure
	 */
	async ensure(uri: string): Promise<void> {
		return this.fetches.get(uri) || this.fetch(uri);
	}

	/**
	 * Fetches the file/directory structure from the remote file system and saves it in the in-memory file system
	 */
	async fetchStructure(token = CancellationToken.None): Promise<void> {
		this.structureFetch = (async () => {
			const uris = await this.remoteFs.getWorkspaceFiles(undefined, token);
			for (const uri of uris) {
				this.inMemoryFs.add(uri);
			}
		})();
		this.structureFetch.catch(err => {
			this.structureFetch = undefined;
		});
		return this.structureFetch;
	}

	/**
	 * Returns a promise that is resolved as soon as the file/directory structure has been synced
	 * from the remote file system to the in-memory file system (at least once)
	 *
	 * TODO use memoize helper and support cancellation with multiple consumers
	 */
	async ensureStructure(): Promise<void> {
		return this.structureFetch || this.fetchStructure();
	}
}
