
import { Span } from 'opentracing';
import * as path from 'path';
import * as url from 'url';
import { FileSystemUpdater } from './fs';
import { Logger, NoopLogger } from './logging';
import { InMemoryFileSystem } from './memfs';

/**
 * Schema of a package.json file
 */
export interface PackageJson {
	name: string;
	version?: string;
	typings?: string;
	repository?: string | { type: string, url: string };
	dependencies?: {
		[packageName: string]: string;
	};
	devDependencies?: {
		[packageName: string]: string;
	};
	peerDependencies?: {
		[packageName: string]: string;
	};
	optionalDependencies?: {
		[packageName: string]: string;
	};
}

/**
 * Matches:
 *
 *     /foo/node_modules/(bar)/index.d.ts
 *     /foo/node_modules/bar/node_modules/(baz)/index.d.ts
 *     /foo/node_modules/(@types/bar)/index.ts
 */
const PACKAGE_NAME_REGEXP = /.*\/node_modules\/((?:@[^\/]+\/)?[^\/]+)\/.*$/;

/**
 * Returns the name of a package that a file is contained in
 */
export function getPackageName(uri: string): string | undefined {
	const match = decodeURIComponent(url.parse(uri).pathname || '').match(PACKAGE_NAME_REGEXP);
	return match && match[1] || undefined;
}

export class PackageManager {

	/**
	 * True if the workspace was scanned for package.json files, they were fetched and parsed
	 */
	private scanned = false;

	/**
	 * Set of package.json URIs _defined_ in the workspace.
	 * This does not include package.jsons of dependencies and also not package.jsons that node_modules are vendored for
	 */
	private packages = new Set<string>();

	/**
	 * The URI of the root package.json, if any
	 */
	public rootPackageJsonUri: string | undefined;

	constructor(
		private updater: FileSystemUpdater,
		private inMemoryFileSystem: InMemoryFileSystem,
		private logger: Logger = new NoopLogger()
	) { }

	/**
	 * Returns an Iterable for all package.jsons in the workspace
	 */
	packageJsonUris(): IterableIterator<string> {
		return this.packages.values();
	}

	/**
	 * Scans the workspace to find all packages _defined_ in the workspace, saves the content in `packages`
	 * For each found package, installation is started in the background and tracked in `installations`
	 *
	 * @param span OpenTracing span for tracing
	 */
	private scan(span = new Span()): void {
		// Find locations of package.json and node_modules folders
		const packageJsons = new Set<string>();
		let rootPackageJsonUri: string | undefined;
		let rootPackageJsonLevel = Infinity;
		for (const uri of this.inMemoryFileSystem.uris()) {
			const parts = url.parse(uri);
			if (!parts.pathname) {
				continue;
			}
			// Search for package.json files _not_ inside node_modules
			if (parts.pathname.endsWith('/package.json') && !parts.pathname.includes('/node_modules/')) {
				packageJsons.add(uri);
				// If the current root package.json is further nested than this one, replace it
				const level = parts.pathname.split('/').length;
				if (level < rootPackageJsonLevel) {
					rootPackageJsonUri = uri;
					rootPackageJsonLevel = level;
				}
			}
		}
		this.rootPackageJsonUri = rootPackageJsonUri;
		this.logger.log(`Found ${packageJsons.size} package.json in workspace`);
		this.logger.log(`Root package.json: ${rootPackageJsonUri}`);
		this.packages.clear();
		for (const uri of packageJsons) {
			this.packages.add(uri);
		}
		this.scanned = true;
	}

	/**
	 * Ensures all package.json have been detected, loaded and installations kicked off
	 *
	 * @param span OpenTracing span for tracing
	 */
	async ensureScanned(span = new Span()): Promise<void> {
		await this.updater.ensureStructure(span);
		if (!this.scanned) {
			this.scan(span);
		}
	}

	/**
	 * Gets the content of the closest package.json known to to the DependencyManager in the ancestors of a URI
	 * Call `ensureScanned()` before.
	 */
	async getClosestPackageJson(uri: string, span = new Span()): Promise<PackageJson | undefined> {
		const packageJsonUri = this.getClosestPackageJsonUri(uri);
		if (!packageJsonUri) {
			return undefined;
		}
		this.updater.ensure(packageJsonUri, span);
		return JSON.parse(await this.inMemoryFileSystem.getContent(packageJsonUri));
	}

	/**
	 * Walks the parent directories of a given URI to find the first package.json that is known to the InMemoryFileSystem
	 *
	 * @param uri URI of a file or directory in the workspace
	 * @return The found package.json or undefined if none found
	 */
	getClosestPackageJsonUri(uri: string): string | undefined {
		const parts = url.parse(uri);
		while (true) {
			if (!parts.pathname) {
				return undefined;
			}
			const packageJsonUri = url.format({ ...parts, pathname: path.posix.join(parts.pathname, 'package.json') });
			if (this.packages.has(packageJsonUri)) {
				return packageJsonUri;
			}
			if (parts.pathname === '/') {
				return undefined;
			}
			parts.pathname = path.posix.dirname(parts.pathname);
		}
	}
}
