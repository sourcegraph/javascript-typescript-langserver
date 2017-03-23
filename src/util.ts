import * as os from 'os';
import * as path from 'path';

import * as ts from 'typescript';
import { Position, Range, SymbolKind } from 'vscode-languageserver';
import * as rt from './request-type';

let strict = false;

/**
 * Toggles "strict" flag, affects how we are parsing/generating URLs.
 * In strict mode we using "file://PATH", otherwise on Windows we are using "file:///PATH"
 */
export function setStrict(value: boolean) {
	strict = value;
}

export function formEmptyRange(): Range {
	return Range.create(Position.create(0, 0), Position.create(0, 0));
}

export function formEmptyPosition(): Position {
	return Position.create(0, 0);
}

export function formEmptyKind(): number {
	return SymbolKind.Namespace;
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

export function convertStringtoSymbolKind(kind: string): SymbolKind {
	switch (kind) {
		case 'file': return SymbolKind.File;
		case 'module': return SymbolKind.Module;
		case 'namespace': return SymbolKind.Namespace;
		case 'package': return SymbolKind.Package;
		case 'class': return SymbolKind.Class;
		case 'method': return SymbolKind.Method;
		case 'property': return SymbolKind.Property;
		case 'field': return SymbolKind.Field;
		case 'constructor': return SymbolKind.Constructor;
		case 'enum': return SymbolKind.Enum;
		case 'interface': return SymbolKind.Interface;
		case 'function': return SymbolKind.Function;
		case 'variable': return SymbolKind.Variable;
		case 'constant': return SymbolKind.Constant;
		case 'string': return SymbolKind.String;
		case 'number': return SymbolKind.Number;
		case 'boolean': return SymbolKind.Boolean;
		case 'array': return SymbolKind.Array;
		case 'array': return SymbolKind.Array;
		case 'sourcefile': return SymbolKind.File;
		case 'alias': return SymbolKind.Variable;
		default: return SymbolKind.String;
	}
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
	p = toUnixPath(p).split('/').map(encodeURIComponent).join('/');
	return ret + p;
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

export function uri2reluri(uri: string, root: string): string {
	return path2uri('', uri2relpath(uri, root));
}

export function uri2relpath(uri: string, root: string): string {
	uri = uri2path(uri);
	root = toUnixPath(root);
	if (uri.startsWith(root)) {
		uri = uri.substring(root.length);
	}
	while (uri.startsWith('/')) {
		uri = uri.substring(1);
	}
	return uri;
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
let jstsPattern = /\.[tj]sx?$/;

export function isJSTSFile(filename: string): boolean {
	return jstsPattern.test(filename);
}

let jstsConfigPattern = /(^|\/)[tj]sconfig\.json$/;

export function isConfigFile(filename: string): boolean {
	return jstsConfigPattern.test(filename);
}

let packageJsonPattern = /(^|\/)package\.json$/;

export function isPackageJsonFile(filename: string): boolean {
	return packageJsonPattern.test(filename);
}

const globalTSPatterns = [
	/(^|\/)globals?\.d\.ts$/,
	/node_modules\/\@types\/node\/.*/,
	/(^|\/)typings\/.*/,
	/(^|\/)tsd\.d\.ts($|\/)/
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
 * defInfoToSymbolDescriptor converts from an instance of
 * ts.DefinitionInfo to an instance of rt.SymbolDescriptor
 */
export function defInfoToSymbolDescriptor(d: ts.DefinitionInfo): rt.SymbolDescriptor {
	return {
		kind: d.kind || '',
		name: stripQuotes(d.name) || '',
		containerKind: d.containerKind || '',
		containerName: (d.containerName ? lastDotCmp(stripQuotes(d.containerName)) : '')
	};
}

export function symbolDescriptorMatch(query: rt.PartialSymbolDescriptor, sym: rt.SymbolDescriptor): boolean {
	for (const key of Object.keys(query)) {
		if ((<any> query)[key] === undefined) {
			continue;
		}
		if (key === 'package') {
			if (!sym.package || !packageDescriptorMatch(query.package!, sym.package)) {
				return false;
			}
			continue;
		}
		if ((<any> query)[key] !== (<any> sym)[key]) {
			return false;
		}
	}
	return true;
}

function packageDescriptorMatch(query: rt.PackageDescriptor, sym: rt.PackageDescriptor): boolean {
	for (const key of Object.keys(query)) {
		if ((<any> query)[key] === undefined) {
			continue;
		}
		if ((<any> query)[key] !== (<any> sym)[key]) {
			return false;
		}
	}
	return true;
}

function stripQuotes(s: string): string {
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.substring(1, s.length - 1);
	}
	return s;
}

function lastDotCmp(s: string): string {
	const cmps = s.split('.');
	return cmps[cmps.length - 1];
}
