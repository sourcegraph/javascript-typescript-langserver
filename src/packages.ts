
import { Observable, Subscription } from '@reactivex/rxjs';
import { Span } from 'opentracing';
import * as path from 'path';
import * as url from 'url';
import { Disposable } from './disposable';
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

export class PackageManager implements Disposable {

	/**
	 * Set of package.json URIs _defined_ in the workspace.
	 * This does not include package.jsons of dependencies and also not package.jsons that node_modules are vendored for.
	 * This is updated as new package.jsons are discovered.
	 */
	private packages = new Set<string>();

	/**
	 * The URI of the root package.json, if any.
	 * This is updated as new package.jsons are discovered.
	 */
	public rootPackageJsonUri: string | undefined;

	/**
	 * Subscriptions to unsubscribe from on object disposal
	 */
	private subscriptions = new Subscription();

	constructor(
		private updater: FileSystemUpdater,
		private inMemoryFileSystem: InMemoryFileSystem,
		private logger: Logger = new NoopLogger()
	) {
		let rootPackageJsonLevel = Infinity;
		// Find locations of package.jsons _not_ inside node_modules
		this.subscriptions.add(
			Observable.fromEvent<[string, string]>(inMemoryFileSystem, 'add', Array.of)
				.subscribe(([uri, content]) => {
					const parts = url.parse(uri);
					if (!parts.pathname	|| !parts.pathname.endsWith('/package.json') || parts.pathname.includes('/node_modules/')) {
						return;
					}
					this.packages.add(uri);
					this.logger.log(`Found package ${uri}`);
					// If the current root package.json is further nested than this one, replace it
					const level = parts.pathname.split('/').length;
					if (level < rootPackageJsonLevel) {
						this.rootPackageJsonUri = uri;
						rootPackageJsonLevel = level;
					}
				})
		);
	}

	dispose(): void {
		this.subscriptions.unsubscribe();
	}

	/**
	 * Returns an Iterable for all package.jsons in the workspace
	 */
	packageJsonUris(): IterableIterator<string> {
		return this.packages.values();
	}

	/**
	 * Gets the content of the closest package.json known to to the DependencyManager in the ancestors of a URI
	 */
	async getClosestPackageJson(uri: string, span = new Span()): Promise<PackageJson | undefined> {
		await this.updater.ensureStructure();
		const packageJsonUri = this.getClosestPackageJsonUri(uri);
		if (!packageJsonUri) {
			return undefined;
		}
		await this.updater.ensure(packageJsonUri, span);
		return JSON.parse(this.inMemoryFileSystem.getContent(packageJsonUri));
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
