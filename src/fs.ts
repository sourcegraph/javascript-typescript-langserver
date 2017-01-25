import {
	RequestType, IConnection
} from 'vscode-languageserver';

import * as fs from 'fs';
import * as path_ from 'path';

export interface FileInfo {
	name: string
	size: number
	dir: boolean
}

export interface FileSystem {
	readDir(path: string, callback: (err: Error, result?: FileInfo[]) => void): void
	readFile(path: string, callback: (err: Error, result?: string) => void): void
}

export namespace ReadDirRequest {
	export const type: RequestType<string, FileInfo[], any> = { get method() { return 'fs/readDir'; } };
}

export namespace ReadFileRequest {
	export const type: RequestType<string, string, any> = { get method() { return 'fs/readFile'; } };
}

export class RemoteFileSystem implements FileSystem {

	private connection: IConnection;

	constructor(connection: IConnection) {
		this.connection = connection
	}

	readDir(path: string, callback: (err: Error | null, result?: FileInfo[]) => void) {
		this.connection.sendRequest(ReadDirRequest.type, path).then((f: FileInfo[]) => {
			return callback(null, f)
		}, callback)
	}

	readFile(path: string, callback: (err: Error | null, result?: string) => void) {
		this.connection.sendRequest(ReadFileRequest.type, path).then((content: string) => {
			return callback(null, Buffer.from(content, 'base64').toString())
		}, callback)
	}

}

export class LocalFileSystem implements FileSystem {

	private root: string;
	private resolver: (...segments: any[]) => string;


	constructor(root: string, resolver: (...segments: any[]) => string = path_.resolve) {
		this.root = root;
		this.resolver = resolver;
	}

	readDir(path: string, callback: (err: Error | null, result?: FileInfo[]) => void): void {
		path = this.resolver(this.root, path);
		fs.readdir(path, (err: Error, files: string[]) => {
			if (err) {
				return callback(err)
			}
			let ret: FileInfo[] = [];
			files.forEach((f) => {
				const stats: fs.Stats = fs.statSync(this.resolver(path, f));
				ret.push({
					name: f,
					size: stats.size,
					dir: stats.isDirectory()
				})
			});
			return callback(null, ret)
		});
	}

	readFile(path: string, callback: (err: Error | null, result?: string) => void): void {
		path = this.resolver(this.root, path);
		fs.readFile(path, (err: Error, buf: Buffer) => {
			if (err) {
				return callback(err)
			}
			return callback(null, buf.toString())
		});
	}

}

export interface MemoryFileSystemNode {
	[name: string]: string | MemoryFileSystemNode;
}

export class MemoryFileSystem implements FileSystem {

	private memfs: MemoryFileSystemNode;

	constructor(memfs: MemoryFileSystemNode) {
		this.memfs = memfs;
	}

	readDir(path: string, callback: (err: Error | null, result?: FileInfo[]) => void): void {
		path = path.replace(/^\//, '');
		const components = path.length ? path.split('/') : [];
		let node = this.memfs;
		let i = 0;
		while (i < components.length) {
			const n = node[components[i]];
			if (!n || typeof n == 'string') {
				return callback(new Error('rd: no such file ' + path));
			}
			node = n as MemoryFileSystemNode;
			i++;
		}
		const keys = Object.keys(node);
		let result: FileInfo[] = []
		keys.forEach((k) => {
			const v = node[k];
			if (typeof v == 'string') {
				result.push({
					name: k,
					size: v.length,
					dir: false
				})
			} else {
				result.push({
					name: k,
					size: 0,
					dir: true
				});
			}
		});
		return callback(null, result);
	}

	readFile(path: string, callback: (err: Error | null, result?: string) => void): void {
		path = path.replace(/^\//, '');
		const components = path.length ? path.split('/') : [];
		let node = this.memfs;
		let i = 0;
		while (i < components.length - 1) {
			const n = node[components[i]];
			if (!n || typeof n == 'string') {
				return callback(new Error('no such file ' + path));
			}
			node = n as MemoryFileSystemNode;
			i++;
		}
		const content = node[components[components.length - 1]];
		if (!content || typeof content != 'string') {
			throw new Error('no such file ' + path);
		}
		return callback(null, content);
	}

}
