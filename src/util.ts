import { Observable } from '@reactivex/rxjs';
import * as os from 'os';
import * as path from 'path';
import { compareTwoStrings } from 'string-similarity';
import * as ts from 'typescript';
import * as url from 'url';
import { PackageDescriptor, SymbolDescriptor } from './request-type';

let strict = false;

/**
 * Converts an Iterable to an Observable.
 * Workaround for https://github.com/ReactiveX/rxjs/issues/2306
 */
export function observableFromIterable<T>(iterable: Iterable<T>): Observable<T> {
	return Observable.from(iterable as any);
}

/**
 * Template string tag to escape JSON Pointer components as per https://tools.ietf.org/html/rfc6901#section-3
 */
export function JSONPTR(strings: TemplateStringsArray, ...toEscape: string[]): string {
	return strings.reduce((prev, curr, i) => prev + toEscape[i - 1].replace(/~/g, '~0').replace(/\//g, '~1') + curr);
}

/**
 * Toggles "strict" flag, affects how we are parsing/generating URLs.
 * In strict mode we using "file://PATH", otherwise on Windows we are using "file:///PATH"
 */
export function setStrict(value: boolean) {
	strict = value;
}

/**
 * Makes documentation string from symbol display part array returned by TS
 */
export function docstring(parts: ts.SymbolDisplayPart[]): string {
	return ts.displayPartsToString(parts);
}

/**
 * Normalizes path to match POSIX standard (slashes)
 */
export function toUnixPath(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

/**
 * Normalizes URI encoding by encoding _all_ special characters in the pathname
 */
export function normalizeUri(uri: string): string {
	const parts = url.parse(uri);
	if (!parts.pathname) {
		return uri;
	}
	const pathParts = parts.pathname.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment)));
	// Decode Windows drive letter colon
	if (/^[a-z]%3A$/i.test(pathParts[1])) {
		pathParts[1] = decodeURIComponent(pathParts[1]);
	}
	parts.pathname = pathParts.join('/');
	return url.format(parts);
}

export function path2uri(root: string, file: string): string {
	let ret = 'file://';
	if (!strict && process.platform === 'win32') {
		ret += '/';
	}
	let p;
	if (root) {
		p = resolve(root, file);
	} else {
		p = file;
	}
	if (/^[a-z]:[\\\/]/i.test(p)) {
		p = '/' + p;
	}
	p = p.split(/[\\\/]/g).map((val, i) => i <= 1 && /^[a-z]:$/i.test(val) ? val : encodeURIComponent(val)).join('/');
	return normalizeUri(ret + p);
}

export function uri2path(uri: string): string {
	if (uri.startsWith('file://')) {
		uri = uri.substring('file://'.length);
		if (process.platform === 'win32') {
			if (!strict) {
				uri = uri.substring(1);
			}
		}
		uri = uri.split('/').map(decodeURIComponent).join('/');
	}
	return uri;
}

export function uriToLocalPath(uri: string): string {
	uri = uri.substring('file://'.length);
	if (/^\/[a-z]:\//i.test(uri)) {
		uri = uri.substring(1);
	}
	return uri.split('/').map(decodeURIComponent).join(path.sep);
}

export function isLocalUri(uri: string): boolean {
	return uri.startsWith('file://');
}

export function resolve(root: string, file: string): string {
	if (!strict || os.platform() !== 'win32') {
		return path.resolve(root, file);
	} else {
		return path.posix.resolve(root, file);
	}

}
const jstsPattern = /\.[tj]sx?$/;

export function isJSTSFile(filename: string): boolean {
	return jstsPattern.test(filename);
}

const jstsConfigPattern = /(^|\/)[tj]sconfig\.json$/;

export function isConfigFile(filename: string): boolean {
	return jstsConfigPattern.test(filename);
}

const packageJsonPattern = /(^|\/)package\.json$/;

export function isPackageJsonFile(filename: string): boolean {
	return packageJsonPattern.test(filename);
}

const globalTSPatterns = [
	/(^|\/)globals?\.d\.ts$/,
	/node_modules\/(?:\@|%40)types\/(node|jasmine|jest|mocha)\/.*\.d\.ts$/,
	/(^|\/)typings\/.*\.d\.ts$/,
	/(^|\/)tsd\.d\.ts($|\/)/,
	/(^|\/)tslib\.d\.ts$/ // for the 'synthetic reference' created by typescript when using importHelpers
];

// isGlobalTSFile returns whether or not the filename contains global
// variables based on a best practices heuristic
// (https://basarat.gitbooks.io/typescript/content/docs/project/modules.html). In
// reality, a file has global scope if it does not begin with an
// import statement, but to check this, we'd have to read each
// TypeScript file.
export function isGlobalTSFile(filename: string): boolean {
	for (const globalTSPattern of globalTSPatterns) {
		if (globalTSPattern.test(filename)) {
			return true;
		}
	}
	return false;
}

export function isDependencyFile(filename: string): boolean {
	return filename.startsWith('node_modules/') || filename.indexOf('/node_modules/') !== -1;
}

export function isDeclarationFile(filename: string): boolean {
	return filename.endsWith('.d.ts');
}

/**
 * Converts filename to POSIX-style absolute one if filename does not denote absolute path already
 */
export function absolutize(filename: string) {
	filename = toUnixPath(filename);
	// If POSIX path does not treats filename as absolute, let's try system-specific one
	if (!path.posix.isAbsolute(filename) && !path.isAbsolute(filename)) {
		filename = '/' + filename;
	}
	return filename;
}

/**
 * Absolutizes directory name and cuts trailing slashes
 */
export function normalizeDir(dir: string) {
	dir = absolutize(dir);
	if (dir !== '/') {
		dir = dir.replace(/[\/]+$/, '');
	}
	return dir;
}

/**
 * Converts a ts.DefinitionInfo to a SymbolDescriptor
 */
export function defInfoToSymbolDescriptor(info: ts.DefinitionInfo, rootPath: string): SymbolDescriptor {
	const symbolDescriptor: SymbolDescriptor = {
		kind: info.kind || '',
		name: info.name || '',
		containerKind: info.containerKind || '',
		containerName: info.containerName || '',
		filePath: info.fileName
	};
	// If the symbol is an external module representing a file, set name to the file path
	if (info.kind === ts.ScriptElementKind.moduleElement && info.name && /[\\\/]/.test(info.name)) {
		symbolDescriptor.name = '"' + info.fileName.replace(/(?:\.d)?\.tsx?$/, '') + '"';
	}
	// If the symbol itself is not a module and there is no containerKind
	// then the container is an external module named by the file name (without file extension)
	if (info.kind !== ts.ScriptElementKind.moduleElement && !info.containerKind && !info.containerName) {
		symbolDescriptor.containerName = '"' + info.fileName.replace(/(?:\.d)?\.tsx?$/, '') + '"';
		symbolDescriptor.containerKind = ts.ScriptElementKind.moduleElement;
	}
	// Make paths relative to root paths
	symbolDescriptor.containerName = symbolDescriptor.containerName.replace(rootPath, '');
	symbolDescriptor.name = symbolDescriptor.name.replace(rootPath, '');
	symbolDescriptor.filePath = symbolDescriptor.filePath.replace(rootPath, '');
	return symbolDescriptor;
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
		return compareTwoStrings(query, value);
	}
	// If query is a scalar value, compare by identity and return 0 or 1
	if (typeof query !== 'object' || query === null) {
		return +(query === value);
	}
	// If value is scalar, return no match
	if (typeof value !== 'object' && value !== null) {
		return 0;
	}
	// Both values are objects, compare each property and sum the scores
	return Object.keys(query).reduce((score, key) => score + getMatchingPropertyCount(query[key], value[key]), 0);
}

/**
 * Returns the maximum score that could be achieved with the given query (the amount of "leaf" properties)
 * E.g. for `{ name, kind, package: { name }}` will return 3
 */
export function getPropertyCount(query: any): number {
	if (typeof query === 'object' && query !== null) {
		return Object.keys(query).reduce((score, key) => score + getPropertyCount(query[key]), 0);
	}
	return 1;
}

/**
 * Returns true if the passed SymbolDescriptor has at least the same properties as the passed partial SymbolDescriptor
 */
export function isSymbolDescriptorMatch(query: Partial<SymbolDescriptor>, symbol: SymbolDescriptor): boolean {
	for (const key of Object.keys(query)) {
		if (!(query as any)[key]) {
			continue;
		}
		if (key === 'package') {
			if (!symbol.package || !isPackageDescriptorMatch(query.package!, symbol.package)) {
				return false;
			}
			continue;
		}
		if ((query as any)[key] !== (symbol as any)[key]) {
			return false;
		}
	}
	return true;
}

function isPackageDescriptorMatch(query: Partial<PackageDescriptor>, pkg: PackageDescriptor): boolean {
	for (const key of Object.keys(query)) {
		if ((query as any)[key] === undefined) {
			continue;
		}
		if ((query as any)[key] !== (pkg as any)[key]) {
			return false;
		}
	}
	return true;
}
