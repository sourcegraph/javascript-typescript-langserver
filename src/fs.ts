import * as fs from 'mz/fs';
import * as path from 'path';
import { CancellationToken } from 'vscode-jsonrpc';
import { TextDocumentIdentifier } from 'vscode-languageserver-types';
import { LanguageClientHandler } from './lang-handler';
import glob = require('glob');
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

	private workspaceFilesPromise?: Promise<string[]>;

	constructor(private client: LanguageClientHandler) {}

	/**
	 * The files request is sent from the server to the client to request a list of all files in the workspace or inside the directory of the base parameter, if given.
	 * A language server can use the result to index files by filtering and doing a content request for each text document of interest.
	 */
	getWorkspaceFiles(base?: string, token = CancellationToken.None): Promise<string[]> {
		// TODO cache this at a different layer and invalidate it properly
		// This is just a quick and dirty solution to avoid multiple requests
		if (!this.workspaceFilesPromise) {
			this.workspaceFilesPromise = this.client.getWorkspaceFiles({ base }, token)
				.then((textDocuments: TextDocumentIdentifier[]) => textDocuments.map(textDocument => textDocument.uri))
				.catch(err => {
					this.workspaceFilesPromise = undefined;
					throw err;
				});
		}
		return this.workspaceFilesPromise;
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

	async getWorkspaceFiles(base: string): Promise<string[]> {
		const files = await new Promise<string[]>((resolve, reject) => {
			glob(path.join(this.resolveUriToPath(base), '**/*.*'), { nodir: true }, (err, matches) => err ? reject(err) : resolve(matches));
		});
		return files.map(file => path2uri('', file));
	}

	async getTextDocumentContent(uri: string): Promise<string> {
		return fs.readFile(this.resolveUriToPath(uri), 'utf8');
	}
}
