
import * as url from 'url';

/** Map from protocol to ProtocolNode */
export class RootNode<V> extends Map<string, ProtocolNode<V>> {}

/** Map from slashes true/false to SlashesNode */
export class ProtocolNode<V> extends Map<boolean, SlashesNode<V>> {}

/** Map from host or no host (empty string) to PathTree */
export class SlashesNode<V> extends Map<string, PathTree<SearchNode<V>>> {}

/** Map from query string or no query to HashNode */
export class SearchNode<V> extends Map<string | null, HashNode<V>> {}

/** Map from hash (aka fragment) or no hash to value */
export class HashNode<V> extends Map<string | null, V> {}

/**
 * A tree capable of storing contents identified by an URI with fast content lookup and readdir operations
 *
 * ```txt
 *  foo://example.com:8042/over/there?name=ferret#nose
 *  \_/   \______________/\_________/ \_________/ \__/
 *   |           |            |            |        |
 * scheme     authority       path        query   fragment
 *   |   _____________________|__
 *  / \ /                        \
 *  urn:example:animal:ferret:nose
 * ```
 */
export class UriTree<V> implements Iterable<[string, V]> {

	private root = new RootNode<V>();

	/**
	 * Returns an Iterator that emits pairs of URI and value
	 */
	*[Symbol.iterator](): Iterator<[string, V]> {
		for (const [protocol, protocolNode] of this.root) {
			for (const [slashes, slashesNode] of protocolNode) {
				for (const [host, pathTree] of slashesNode) {
					for (const [pathname, searchNode] of pathTree) {
						for (const [search, hashNode] of searchNode) {
							for (const [hash, content] of hashNode) {
								const uri = url.format({ protocol, slashes, host, pathname, search: search as string | undefined, hash: hash as string | undefined });
								yield [uri, content];
							}
						}
					}
				}
			}
		}
	}

	get(uri: string): V | undefined {
		const parts = url.parse(uri);

		// Protocol
		if (!parts.protocol) {
			throw new Error(`Invalid URI ${uri}, no protocol`);
		}
		const protocolNode = this.root.get(parts.protocol);
		if (!protocolNode) {
			return undefined;
		}

		// Slashes
		const slashesNode = protocolNode.get(!!parts.slashes);
		if (!slashesNode) {
			return undefined;
		}

		// Host
		const pathTree = slashesNode.get(parts.host as string);
		if (!pathTree) {
			return undefined;
		}

		// Path
		const searchNode = pathTree.get(parts.pathname || '');
		if (!searchNode) {
			return undefined;
		}

		// Hash
		const hashNode = searchNode.get(parts.search as string | null);
		if (!hashNode) {
			return undefined;
		}

		// Content
		return hashNode.get(parts.hash as string | null);
	}

	/**
	 * Get the node at the given URI prefix
	 */
	getNode(uri: string): RootNode<V> | ProtocolNode<V> | SlashesNode<V> | PathNode<SearchNode<V>> | SearchNode<V> | HashNode<V> | V | undefined {
		const parts = url.parse(uri);

		// Protocol
		if (!parts.protocol) {
			return this.root;
		}
		const protocolNode = this.root.get(parts.protocol);
		if (!protocolNode) {
			return undefined;
		}

		// Slashes
		const slashesNode = protocolNode.get(!!parts.slashes);
		if (!slashesNode) {
			return undefined;
		}

		// Host
		const pathTree = slashesNode.get(parts.host as string);
		if (!pathTree) {
			return undefined;
		}

		// Path
		const pathNode = pathTree.getNode(parts.pathname || '');
		if (pathNode) {
			return pathNode;
		}
		const searchNode = pathTree.get(parts.pathname || '');
		if (!searchNode) {
			return undefined;
		}

		// Hash
		const hashNode = searchNode.get(parts.search as string | null);
		if (!hashNode) {
			return undefined;
		}

		// Content
		return hashNode.get(parts.hash as string | null);
	}

	/**
	 * Returns the first entry that matches the path
	 */
	getPath(path: string): V | undefined {
		for (const protocolNode of this.root.values()) {
			for (const slashesNode of protocolNode.values()) {
				for (const pathTree of slashesNode.values()) {
					if (pathTree.has(path)) {
						const searchNode = pathTree.get(path)!;
						if (searchNode.size > 0) {
							const hashNode = searchNode.values().next().value!;
							if (hashNode.size > 0) {
								return hashNode.values().next().value!;
							}
						}
					}
				}
			}
		}
		return undefined;
	}

	/**
	 * Returns the first PathNode that matches the path
	 */
	getPathNode(path: string): PathNode<SearchNode<V>> | undefined {
		for (const protocolNode of this.root.values()) {
			for (const slashesNode of protocolNode.values()) {
				for (const pathTree of slashesNode.values()) {
					const node = pathTree.getNode(path);
					if (node) {
						return node;
					}
				}
			}
		}
		return undefined;
	}

	/**
	 * Returns true if there is an entry that matches the path
	 */
	hasPath(path: string): boolean {
		for (const protocolNode of this.root.values()) {
			for (const slashesNode of protocolNode.values()) {
				for (const pathTree of slashesNode.values()) {
					if (pathTree.has(path)) {
						const searchNode = pathTree.get(path)!;
						if (searchNode.size > 0) {
							const hashNode = searchNode.values().next().value!;
							if (hashNode.size > 0) {
								return true;
							}
						}
					}
				}
			}
		}
		return false;
	}

	has(uri: string): boolean {
		const parts = url.parse(uri);

		// Protocol
		if (!parts.protocol) {
			throw new Error(`Invalid URI ${uri}, no protocol`);
		}
		const protocolNode = this.root.get(parts.protocol);
		if (!protocolNode) {
			return false;
		}

		// Slashes
		const slashesNode = protocolNode.get(!!parts.slashes);
		if (!slashesNode) {
			return false;
		}

		// Host
		const pathTree = slashesNode.get(parts.host as string);
		if (!pathTree) {
			return false;
		}

		// Path
		const searchNode = pathTree.get(parts.pathname || '');
		if (!searchNode) {
			return false;
		}

		// Hash
		const hashNode = searchNode.get(parts.search as string | null);
		if (!hashNode) {
			return false;
		}

		// Content
		return hashNode.has(parts.hash as string | null);
	}

	set(uri: string, value: V): void {
		const parts = url.parse(uri);

		// Protocol
		if (!parts.protocol) {
			throw new Error(`Invalid URI ${uri}, no protocol`);
		}
		let protocolNode = this.root.get(parts.protocol);
		if (!protocolNode) {
			protocolNode = new ProtocolNode<V>();
			this.root.set(parts.protocol, protocolNode);
		}

		// Slashes
		let slashesNode = protocolNode.get(!!parts.slashes);
		if (!slashesNode) {
			slashesNode = new SlashesNode<V>();
			protocolNode.set(!!parts.slashes, slashesNode);
		}

		// Host
		let pathTree = slashesNode.get(parts.host!);
		if (!pathTree) {
			pathTree = new PathTree<SearchNode<V>>();
			slashesNode.set(parts.host!, pathTree);
		}

		// Path
		let searchNode = pathTree.get(parts.pathname || '');
		if (!searchNode) {
			searchNode = new SearchNode<V>();
			pathTree.set(parts.pathname || '', searchNode);
		}

		// Hash
		let hashNode = searchNode.get(parts.search as string | null);
		if (!hashNode) {
			hashNode = new HashNode<V>();
			searchNode.set(parts.search as string | null, hashNode);
		}

		// Content
		hashNode.set(parts.hash as string | null, value);
	}

	/**
	 * Deletes the given URI from the tree
	 */
	delete(uri: string): void {
		const parts = url.parse(uri);

		// Protocol
		if (!parts.protocol) {
			throw new Error(`Invalid URI ${uri}, no protocol`);
		}
		let protocolNode = this.root.get(parts.protocol);
		if (!protocolNode) {
			return;
		}

		// Slashes
		let slashesNode = protocolNode.get(!!parts.slashes);
		if (!slashesNode) {
			return;
		}

		// Host
		let pathTree = slashesNode.get(parts.host!);
		if (!pathTree) {
			return;
		}

		// Path
		let searchNode = pathTree.get(parts.pathname || '');
		if (!searchNode) {
			return;
		}

		// Hash
		let hashNode = searchNode.get(parts.search as string | null);
		if (!hashNode) {
			return;
		}

		// Content
		hashNode.delete(parts.hash as string | null);
	}

	/**
	 * Deletes all entries from the tree
	 */
	clear(): void {
		this.root.clear();
	}
}

/**
 * Map from path segment to next segment or optional document content.
 * Represents a directory
 */
export class PathNode<V> extends Map<string, PathNode<V> | V> {}

/**
 * A Map that maps paths seperated by a delimiter (e.g. slash) to optional contents, represented as a tree.
 * This allows both fast content lookup and readdir operations
 */
export class PathTree<V> {

	private root = new PathNode<V>();

	/**
	 * Returns an iterator that emits pairs of path, value
	 */
	*[Symbol.iterator](): Iterator<[string, V]> {
		const queue: [string, PathNode<V>][] = [['', this.root]];
		while (queue.length > 0) {
			const [path, node] = queue.shift()!;
			for (const [key, value] of node) {
				if (value instanceof PathNode) {
					queue.push([path + '/' + key, value]);
				} else {
					yield [path + '/' + key, value];
				}
			}
		}
	}

	/**
	 * Sets the file content at the given path to the given content
	 *
	 * @param path File path. Leading or trailing slashes are ignored
	 */
	set(path: string, value: V): void {
		let node = this.root;
		const segments = path.split('/').filter(s => s.length > 0);
		if (segments.length === 0) {
			throw new Error(`Invalid path ${path}, no name given`);
		}
		// Add or walk nodes for all segments except the last one
		for (const segment of segments.slice(0, -1)) {
			// If node doesn't exist yet, create it
			if (!node.has(segment)) {
				node.set(segment, new PathNode<V>());
			}
			// Node is guaranteed to exist
			const n = node.get(segment)!;
			// If node is not a directory, no children can be added
			if (!(n instanceof PathNode)) {
				throw new Error(`Cannot set path ${path} because ${segment} is not a directory`);
			}
			// Continue with next segment
			node = n;
		}
		// Set last segment to content
		node.set(segments[segments.length - 1], value);
	}

	/**
	 * Gets the file content of the given path, or undefined if it is not known
	 */
	get(path: string): V | undefined {
		let node = this.root;
		const segments = path.split('/').filter(s => s.length > 0);
		for (const segment of segments) {
			const n = node.get(segment);
			if (!(n instanceof PathNode)) {
				return n;
			}
			node = n;
		}
		return undefined;
	}

	/**
	 * Get a directory node at the given path
	 */
	getNode(path: string): PathNode<V> | undefined {
		let node = this.root;
		const segments = path.split('/').filter(s => s.length > 0);
		for (const segment of segments) {
			if (!node.has(segment)) {
				return undefined;
			}
			const n = node.get(segment)!;
			if (!(n instanceof PathNode)) {
				throw new Error(`Cannot get node at ${path} because ${segment} is not a node`);
			}
			node = n;
		}
		return node;
	}

	/**
	 * Returns true if the given path exists (even if the content is undefined)
	 */
	has(path: string): boolean {
		let node = this.root;
		const segments = path.split('/').filter(s => s.length > 0);
		for (const segment of segments) {
			if (!node.has(segment)) {
				return false;
			}
			const n = node.get(segment);
			if (!(n instanceof PathNode)) {
				return true;
			}
			node = n;
		}
		return false;
	}

	/**
	 * Deletes the given path if it exists (and all its children)
	 */
	delete(path: string): void {
		let node = this.root;
		const segments = path.split('/').filter(s => s.length > 0);
		for (const segment of segments.slice(0, -1)) {
			const n = node.get(segment);
			if (!(n instanceof PathNode)) {
				// Path doesn't exist
				return;
			}
			node = n;
		}
		// Delete final segment
		node.delete(segments[segments.length - 1]);
	}

	/**
	 * Deletes all entries from the tree
	 */
	clear(): void {
		this.root.clear();
	}
}
