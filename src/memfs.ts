import * as fs_ from 'fs';
import * as path_ from 'path';
import * as ts from 'typescript';
import { Logger, NoopLogger } from './logging';
import * as match from './match-files';
import * as util from './util';

/**
 * In-memory file cache node which represents either a folder or a file
 */
export interface FileSystemNode {
	file: boolean;
	children: Map<string, FileSystemNode>;
};

/**
 * In-memory file system, can be served as a ParseConfigHost (thus allowing listing files that belong to project based on tsconfig.json options)
 */
export class InMemoryFileSystem implements ts.ParseConfigHost, ts.ModuleResolutionHost {

	/**
	 * Contains a Map of all URIs that exist in the workspace, optionally with a content.
	 * File contents for URIs in it do not neccessarily have to be fetched already.
	 */
	private files = new Map<string, string | undefined>();

	/**
	 * Map (relative filepath -> string content) of temporary files made while user modifies local file(s).  Paths are relative to `this.path`
	 *
	 * TODO make this use URIs too
	 */
	overlay: Map<string, string>;

	/**
	 * Should we take into account register when performing a file name match or not. On Windows when using local file system, file names are case-insensitive
	 */
	useCaseSensitiveFileNames: boolean;

	/**
	 * Root path
	 */
	path: string;

	/**
	 * File tree root
	 */
	rootNode: FileSystemNode;

	constructor(path: string, private logger: Logger = new NoopLogger()) {
		this.path = path;
		this.overlay = new Map<string, string>();
		this.rootNode = { file: false, children: new Map<string, FileSystemNode>() };
	}

	isTypeScriptLibrary(path: string): boolean {
		return getTypeScriptLibraries().has(util.toUnixPath(path));
	}

	/**
	 * Returns an IterableIterator for all URIs known to exist in the workspace (content loaded or not)
	 */
	uris(): IterableIterator<string> {
		return this.files.keys();
	}

	/**
	 * Adds a file to the local cache
	 *
	 * @param uri The URI of the file
	 * @param content The optional content
	 */
	add(uri: string, content?: string): void {
		// Make sure not to override existing content with undefined
		if (content !== undefined || !this.files.has(uri)) {
			this.files.set(uri, content);
		}
		// Add to directory tree
		const filePath = path_.posix.relative(this.path, util.uri2path(uri));
		const components = filePath.split('/');
		let node = this.rootNode;
		for (const [i, component] of components.entries()) {
			const n = node.children.get(component);
			if (!n) {
				if (i < components.length - 1) {
					const n = { file: false, children: new Map<string, FileSystemNode>() };
					node.children.set(component, n);
					node = n;
				} else {
					node.children.set(component, { file: true, children: new Map<string, FileSystemNode>() });
				}
			} else {
				node = n;
			}
		}
	}

	/**
	 * Returns the file content for the given URI.
	 * Will throw an Error if no available in-memory.
	 * Use FileSystemUpdater.ensure() to ensure that the file is available.
	 *
	 * TODO take overlay into account
	 */
	getContent(uri: string): string {
		let content = this.files.get(uri);
		if (content === undefined) {
			content = getTypeScriptLibraries().get(util.uri2path(uri));
		}
		if (content === undefined) {
			throw new Error(`Content of ${uri} is not available in memory`);
		}
		return content;
	}

	/**
	 * Tells if a file denoted by the given name exists in the workspace (does not have to be loaded)
	 *
	 * @param path File path or URI (both absolute or relative file paths are accepted)
	 */
	fileExists(path: string): boolean {
		return this.readFileIfExists(path) !== undefined || this.files.has(path) || this.files.has(util.path2uri(this.path, path));
	}

	/**
	 * @param path file path (both absolute or relative file paths are accepted)
	 * @return file's content in the following order (overlay then cache).
	 * If there is no such file, returns empty string to match expected signature
	 */
	readFile(path: string): string {
		return this.readFileIfExists(path) || '';
	}

	/**
	 * @param path file path (both absolute or relative file paths are accepted)
	 * @return file's content in the following order (overlay then cache).
	 * If there is no such file, returns undefined
	 */
	private readFileIfExists(path: string): string | undefined {

		let content = this.overlay.get(path);
		if (content !== undefined) {
			return content;
		}

		const rel = path_.posix.relative('/', path);
		content = this.overlay.get(rel);
		if (content !== undefined) {
			return content;
		}

		// TODO This assumes that the URI was a file:// URL.
		//      In reality it could be anything, and the first URI matching the path should be used.
		//      With the current Map, the search would be O(n), it would require a tree to get O(log(n))
		content = this.files.get(util.path2uri(this.path, path));
		if (content !== undefined) {
			return content;
		}

		return getTypeScriptLibraries().get(path);
	}

	/**
	 * Invalidates temporary content denoted by the given path
	 * @param path path to a file relative to project root
	 */
	didClose(path: string) {
		this.overlay.delete(path);
	}

	/**
	 * Adds temporary content denoted by the given path
	 * @param path path to a file relative to project root
	 */
	didSave(path: string) {
		const content = this.readFileIfExists(path);
		if (content !== undefined) {
			this.add(util.path2uri('', path), content);
		}
	}

	/**
	 * Updates temporary content denoted by the given path
	 * @param path path to a file relative to project root
	 */
	didChange(path: string, text: string) {
		this.overlay.set(path, text);
	}

	/**
	 * Called by TS service to scan virtual directory when TS service looks for source files that belong to a project
	 */
	readDirectory(rootDir: string, extensions: string[], excludes: string[], includes: string[]): string[] {
		return match.matchFiles(rootDir,
			extensions,
			excludes,
			includes,
			true,
			this.path,
			p => this.getFileSystemEntries(p));
	}

	/**
	 * Called by TS service to scan virtual directory when TS service looks for source files that belong to a project
	 */
	getFileSystemEntries(path: string): match.FileSystemEntries {
		const ret: { files: string[], directories: string[] } = { files: [], directories: [] };
		let node = this.rootNode;
		const components = path.split('/').filter(c => c);
		if (components.length !== 1 || components[0]) {
			for (const component of components) {
				const n = node.children.get(component);
				if (!n) {
					return ret;
				}
				node = n;
			}
		}
		node.children.forEach((value, name) => {
			if (value.file) {
				ret.files.push(name);
			} else {
				ret.directories.push(name);
			}
		});
		return ret;
	}

	trace(message: string) {
		this.logger.log(message);
	}
}

/**
 * Iterates over in-memory cache calling given function on each node until callback signals abort or all nodes were traversed
 */
export function walkInMemoryFs(fs: InMemoryFileSystem, rootdir: string, walkfn: (path: string, isdir: boolean) => Error | void): Error | void {
	const err = walkfn(rootdir, true);
	if (err) {
		if (err === skipDir) {
			return;
		}
		return err;
	}
	const { files, directories } = fs.getFileSystemEntries(rootdir);
	for (const file of files) {
		const err = walkfn(path_.posix.join(rootdir, file), false);
		if (err) {
			return err;
		}
	}
	for (const dir of directories) {
		const err = walkInMemoryFs(fs, path_.posix.join(rootdir, dir), walkfn);
		if (err) {
			return err;
		}
	}
	return;
}

/**
 * TypeScript library files fetched from the local file system (bundled TS)
 */
let tsLibraries: Map<string, string>;

/**
 * Fetches TypeScript library files from local file system
 */
export function getTypeScriptLibraries(): Map<string, string> {
	if (!tsLibraries) {
		tsLibraries = new Map<string, string>();
		const path = path_.dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2015 }));
		fs_.readdirSync(path).forEach(file => {
			const fullPath = path_.join(path, file);
			if (fs_.statSync(fullPath).isFile()) {
				tsLibraries.set(util.toUnixPath(fullPath), fs_.readFileSync(fullPath).toString());
			}
		});
	}
	return tsLibraries;
}

/**
 * Indicates that tree traversal function should stop
 */
export const skipDir: Error = {
	name: 'WALK_FN_SKIP_DIR',
	message: ''
};
