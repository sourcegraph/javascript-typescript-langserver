import { escapePathComponent } from 'fast-json-patch'
import { Observable } from 'rxjs'
import { compareTwoStrings } from 'string-similarity'
import * as ts from 'typescript'
import * as url from 'url'
import { PackageDescriptor, SymbolDescriptor } from './request-type'

/**
 * Converts an Iterable to an Observable.
 * Workaround for https://github.com/ReactiveX/rxjs/issues/2306
 */
export function observableFromIterable<T>(iterable: Iterable<T>): Observable<T> {
    return Observable.from(iterable as any)
}

/**
 * Template string tag to escape JSON Pointer components as per https://tools.ietf.org/html/rfc6901#section-3
 */
export function JSONPTR(strings: TemplateStringsArray, ...toEscape: string[]): string {
    return strings.reduce((left, right, i) => left + escapePathComponent(toEscape[i - 1]) + right)
}

/**
 * Makes documentation string from symbol display part array returned by TS
 */
export function docstring(parts: ts.SymbolDisplayPart[]): string {
    return ts.displayPartsToString(parts)
}

/**
 * Normalizes path to match POSIX standard (slashes)
 * This conversion should only be necessary to convert windows paths when calling TS APIs.
 */
export function toUnixPath(filePath: string): string {
    return filePath.replace(/\\/g, '/')
}

/**
 * Normalizes URI encoding by encoding _all_ special characters in the pathname
 */
export function normalizeUri(uri: string): string {
    const parts = url.parse(uri)
    if (!parts.pathname) {
        return uri
    }
    const pathParts = parts.pathname.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment)))
    // Decode Windows drive letter colon
    if (/^[a-z]%3A$/i.test(pathParts[1])) {
        pathParts[1] = decodeURIComponent(pathParts[1])
    }
    parts.pathname = pathParts.join('/')
    return url.format(parts)
}

/**
 * Converts an abolute path to a file:// uri
 *
 * @param path an absolute path
 */
export function path2uri(path: string): string {
    // Require a leading slash, on windows prefixed with drive letter
    if (!/^(?:[a-z]:)?[\\\/]/i.test(path)) {
        throw new Error(`${path} is not an absolute path`)
    }

    const parts = path.split(/[\\\/]/)

    // If the first segment is a Windows drive letter, prefix with a slash and skip encoding
    let head = parts.shift()!
    if (head !== '') {
        head = '/' + head
    } else {
        head = encodeURIComponent(head)
    }

    return `file://${head}/${parts.map(encodeURIComponent).join('/')}`
}

/**
 * Converts a uri to an absolute path.
 * The OS style is determined by the URI. E.g. `file:///c:/foo` always results in `c:\foo`
 *
 * @param uri a file:// uri
 */
export function uri2path(uri: string): string {
    const parts = url.parse(uri)
    if (parts.protocol !== 'file:') {
        throw new Error('Cannot resolve non-file uri to path: ' + uri)
    }

    let filePath = parts.pathname || ''

    // If the path starts with a drive letter, return a Windows path
    if (/^\/[a-z]:\//i.test(filePath)) {
        filePath = filePath.substr(1).replace(/\//g, '\\')
    }

    return decodeURIComponent(filePath)
}

const jstsPattern = /\.[tj]sx?$/

export function isJSTSFile(filename: string): boolean {
    return jstsPattern.test(filename)
}

const jstsConfigPattern = /(^|\/)[tj]sconfig\.json$/

export function isConfigFile(filename: string): boolean {
    return jstsConfigPattern.test(filename)
}

const packageJsonPattern = /(^|\/)package\.json$/

export function isPackageJsonFile(filename: string): boolean {
    return packageJsonPattern.test(filename)
}

const globalTSPatterns = [
    /(^|\/)globals?\.d\.ts$/,
    /node_modules\/(?:\@|%40)types\/(node|jasmine|jest|mocha)\/.*\.d\.ts$/,
    /(^|\/)typings\/.*\.d\.ts$/,
    /(^|\/)tsd\.d\.ts($|\/)/,
    /(^|\/)tslib\.d\.ts$/, // for the 'synthetic reference' created by typescript when using importHelpers
]

// isGlobalTSFile returns whether or not the filename contains global
// variables based on a best practices heuristic
// (https://basarat.gitbooks.io/typescript/content/docs/project/modules.html). In
// reality, a file has global scope if it does not begin with an
// import statement, but to check this, we'd have to read each
// TypeScript file.
export function isGlobalTSFile(filename: string): boolean {
    for (const globalTSPattern of globalTSPatterns) {
        if (globalTSPattern.test(filename)) {
            return true
        }
    }
    return false
}

export function isDependencyFile(filename: string): boolean {
    return filename.startsWith('node_modules/') || filename.indexOf('/node_modules/') !== -1
}

export function isDeclarationFile(filename: string): boolean {
    return filename.endsWith('.d.ts')
}

/**
 * Compares two values and returns a numeric score between 0 and 1 defining of how well they match.
 * E.g. if 2 of 4 properties in the query match, will return 2
 */
export function getMatchingPropertyCount(query: any, value: any): number {
    // Compare strings by similarity
    // This allows to match a path like "lib/foo/bar.d.ts" with "src/foo/bar.ts"
    // Last check is a workaround for https://github.com/aceakash/string-similarity/issues/6
    if (typeof query === 'string' && typeof value === 'string' && !(query.length <= 1 && value.length <= 1)) {
        return compareTwoStrings(query, value)
    }
    // If query is a scalar value, compare by identity and return 0 or 1
    if (typeof query !== 'object' || query === null) {
        return +(query === value)
    }
    // If value is scalar, return no match
    if (typeof value !== 'object' && value !== null) {
        return 0
    }
    // Both values are objects, compare each property and sum the scores
    return Object.keys(query).reduce((score, key) => score + getMatchingPropertyCount(query[key], value[key]), 0)
}

/**
 * Returns the maximum score that could be achieved with the given query (the amount of "leaf" properties)
 * E.g. for `{ name, kind, package: { name }}` will return 3
 */
export function getPropertyCount(query: any): number {
    if (typeof query === 'object' && query !== null) {
        return Object.keys(query).reduce((score, key) => score + getPropertyCount(query[key]), 0)
    }
    return 1
}

/**
 * Returns true if the passed SymbolDescriptor has at least the same properties as the passed partial SymbolDescriptor
 */
export function isSymbolDescriptorMatch(query: Partial<SymbolDescriptor>, symbol: SymbolDescriptor): boolean {
    for (const key of Object.keys(query)) {
        if (!(query as any)[key]) {
            continue
        }
        if (key === 'package') {
            if (!symbol.package || !isPackageDescriptorMatch(query.package!, symbol.package)) {
                return false
            }
            continue
        }
        if ((query as any)[key] !== (symbol as any)[key]) {
            return false
        }
    }
    return true
}

function isPackageDescriptorMatch(query: Partial<PackageDescriptor>, pkg: PackageDescriptor): boolean {
    for (const key of Object.keys(query)) {
        if ((query as any)[key] === undefined) {
            continue
        }
        if ((query as any)[key] !== (pkg as any)[key]) {
            return false
        }
    }
    return true
}
