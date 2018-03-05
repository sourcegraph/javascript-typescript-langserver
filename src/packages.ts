import { EventEmitter } from 'events'
import { Span } from 'opentracing'
import * as path from 'path'
import { Observable, Subscription } from 'rxjs'
import * as url from 'url'
import { Disposable } from './disposable'
import { FileSystemUpdater } from './fs'
import { Logger, NoopLogger } from './logging'
import { InMemoryFileSystem } from './memfs'
import { traceObservable } from './tracing'

/**
 * Schema of a package.json file
 */
export interface PackageJson {
    name?: string
    version?: string
    typings?: string
    repository?: string | { type: string; url: string }
    dependencies?: {
        [packageName: string]: string
    }
    devDependencies?: {
        [packageName: string]: string
    }
    peerDependencies?: {
        [packageName: string]: string
    }
    optionalDependencies?: {
        [packageName: string]: string
    }
}

export const DEPENDENCY_KEYS: ReadonlyArray<
    'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'
> = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/**
 * Matches:
 *
 *     /foo/node_modules/(bar)/index.d.ts
 *     /foo/node_modules/bar/node_modules/(baz)/index.d.ts
 *     /foo/node_modules/(@types/bar)/index.ts
 */
const NODE_MODULES_PACKAGE_NAME_REGEXP = /.*\/node_modules\/((?:@[^\/]+\/)?[^\/]+)\/.*$/

/**
 * Returns the name of a package that a file is contained in
 */
export function extractNodeModulesPackageName(uri: string): string | undefined {
    const match = decodeURIComponent(url.parse(uri).pathname || '').match(NODE_MODULES_PACKAGE_NAME_REGEXP)
    return match ? match[1] : undefined
}

/**
 * Matches:
 *
 *     /foo/types/(bar)/index.d.ts
 *     /foo/types/bar/node_modules/(baz)/index.d.ts
 *     /foo/types/(@types/bar)/index.ts
 */
const DEFINITELY_TYPED_PACKAGE_NAME_REGEXP = /\/types\/((?:@[^\/]+\/)?[^\/]+)\/.*$/

/**
 * Returns the name of a package that a file in DefinitelyTyped defines.
 * E.g. `file:///foo/types/node/index.d.ts` -> `@types/node`
 */
export function extractDefinitelyTypedPackageName(uri: string): string | undefined {
    const match = decodeURIComponent(url.parse(uri).pathname || '').match(DEFINITELY_TYPED_PACKAGE_NAME_REGEXP)
    return match ? '@types/' + match[1] : undefined
}

export class PackageManager extends EventEmitter implements Disposable {
    /**
     * Map of package.json URIs _defined_ in the workspace to optional content.
     * Does not include package.jsons of dependencies.
     * Updated as new package.jsons are discovered.
     */
    private packages = new Map<string, PackageJson | undefined>()

    /**
     * The URI of the root package.json, if any.
     * Updated as new package.jsons are discovered.
     */
    public rootPackageJsonUri: string | undefined

    /**
     * Subscriptions to unsubscribe from on object disposal
     */
    private subscriptions = new Subscription()

    constructor(
        private updater: FileSystemUpdater,
        private inMemoryFileSystem: InMemoryFileSystem,
        private logger: Logger = new NoopLogger()
    ) {
        super()
        let rootPackageJsonLevel = Infinity
        // Find locations of package.jsons _not_ inside node_modules
        this.subscriptions.add(
            Observable.fromEvent<[string, string]>(this.inMemoryFileSystem, 'add', (k, v) => [k, v]).subscribe(
                ([uri, content]) => {
                    const parts = url.parse(uri)
                    if (
                        !parts.pathname ||
                        !parts.pathname.endsWith('/package.json') ||
                        parts.pathname.includes('/node_modules/')
                    ) {
                        return
                    }
                    let parsed: PackageJson | undefined
                    if (content) {
                        try {
                            parsed = JSON.parse(content)
                        } catch (err) {
                            logger.error(`Error parsing package.json:`, err)
                        }
                    }
                    // Don't override existing content with undefined
                    if (parsed || !this.packages.get(uri)) {
                        this.packages.set(uri, parsed)
                        this.logger.log(`Found package ${uri}`)
                        this.emit('parsed', uri, parsed)
                    }
                    // If the current root package.json is further nested than this one, replace it
                    const level = parts.pathname.split('/').length
                    if (level < rootPackageJsonLevel) {
                        this.rootPackageJsonUri = uri
                        rootPackageJsonLevel = level
                    }
                }
            )
        )
    }

    public dispose(): void {
        this.subscriptions.unsubscribe()
    }

    /** Emitted when a new package.json was found and parsed */
    public on(event: 'parsed', listener: (uri: string, packageJson: PackageJson) => void): this
    public on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener)
    }

    /**
     * Returns an Iterable for all package.jsons in the workspace
     */
    public packageJsonUris(): IterableIterator<string> {
        return this.packages.keys()
    }

    /**
     * Gets the content of the closest package.json known to to the DependencyManager in the ancestors of a URI
     *
     * @return Observable that emits a single PackageJson or never
     */
    public getClosestPackageJson(uri: string, span = new Span()): Observable<PackageJson> {
        return this.updater.ensureStructure().concat(
            Observable.defer(() => {
                const packageJsonUri = this.getClosestPackageJsonUri(uri)
                if (!packageJsonUri) {
                    return Observable.empty<never>()
                }
                return this.getPackageJson(packageJsonUri, span)
            })
        )
    }

    /**
     * Returns the parsed package.json of the passed URI
     *
     * @param uri URI of the package.json
     * @return Observable that emits a single PackageJson or never
     */
    public getPackageJson(uri: string, childOf = new Span()): Observable<PackageJson> {
        return traceObservable('Get package.json', childOf, span => {
            span.addTags({ uri })
            if (uri.includes('/node_modules/')) {
                return Observable.throw(new Error(`Not an own package.json: ${uri}`))
            }
            let packageJson = this.packages.get(uri)
            if (packageJson) {
                return Observable.of(packageJson)
            }
            return this.updater.ensure(uri, span).concat(
                Observable.defer(() => {
                    packageJson = this.packages.get(uri)!
                    if (!packageJson) {
                        return Observable.throw(new Error(`Expected ${uri} to be registered in PackageManager`))
                    }
                    return Observable.of(packageJson)
                })
            )
        })
    }

    /**
     * Walks the parent directories of a given URI to find the first package.json that is known to the InMemoryFileSystem
     *
     * @param uri URI of a file or directory in the workspace
     * @return The found package.json or undefined if none found
     */
    public getClosestPackageJsonUri(uri: string): string | undefined {
        const parts: url.UrlObject = url.parse(uri)
        while (true) {
            if (!parts.pathname) {
                return undefined
            }
            const packageJsonUri = url.format({ ...parts, pathname: path.posix.join(parts.pathname, 'package.json') })
            if (this.packages.has(packageJsonUri)) {
                return packageJsonUri
            }
            if (parts.pathname === '/') {
                return undefined
            }
            parts.pathname = path.posix.dirname(parts.pathname)
        }
    }
}
