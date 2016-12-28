import * as os from "os";
import * as path from "path";

import * as ts from "typescript";
import { SymbolKind, Range, Position } from 'vscode-languageserver';

var strict = false;

/**
 * Toggles "strict" flag, affects how we are parsing/generating URLs.
 * In strict mode we using "file://PATH", otherwise on Windows we are using "file:///PATH"
 */
export function setStrict(value: boolean) {
	strict = value;
}

export function formEmptyRange(): Range {
	return Range.create(Position.create(0, 0), Position.create(0, 0))
}

export function formEmptyPosition(): Position {
	return Position.create(0, 0);
}

export function formEmptyKind(): number {
	return SymbolKind.Namespace
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
export function normalizePath(file: string): string {
	return file.replace(new RegExp('\\' + path.sep, 'g'), path.posix.sep);
}

export function convertStringtoSymbolKind(kind: string): SymbolKind {
	switch (kind) {
		case "file": return SymbolKind.File;
		case "module": return SymbolKind.Module
		case "namespace": return SymbolKind.Namespace
		case "package": return SymbolKind.Package
		case "class": return SymbolKind.Class
		case "method": return SymbolKind.Method
		case "property": return SymbolKind.Property
		case "field": return SymbolKind.Field
		case "constructor": return SymbolKind.Constructor
		case "enum": return SymbolKind.Enum
		case "interface": return SymbolKind.Interface
		case "function": return SymbolKind.Function
		case "variable": return SymbolKind.Variable
		case "constant": return SymbolKind.Constant
		case "string": return SymbolKind.String
		case "number": return SymbolKind.Number
		case "boolean": return SymbolKind.Boolean
		case "array": return SymbolKind.Array
		case "array": return SymbolKind.Array
		case "sourcefile": return SymbolKind.File
		default: return SymbolKind.String
	}
}

export function path2uri(root: string, file: string): string {
	let ret = 'file://';
	if (!strict && process.platform == 'win32') {
		ret += '/';
	}
	let p;
	if (root) {
		p = resolve(root, file);
	} else {
		p = file;
	}
	return ret + normalizePath(p);
}

export function uri2path(uri: string): string {
	if (uri.startsWith('file://')) {
		uri = uri.substring('file://'.length);
		if (process.platform == 'win32') {
			if (!strict) {
				uri = uri.substring(1);
			}
			uri = uri.replace(/%3A/g, ':');
		}
	}
	return uri;
}

export function uri2reluri(uri: string, root: string): string {
	return path2uri('', uri2relpath(uri, root));
}

export function uri2relpath(uri: string, root: string): string {
	uri = uri2path(uri);
	root = normalizePath(root);
	if (uri.startsWith(root)) {
		uri = uri.substring(root.length);
	}
	while (uri.startsWith('/')) {
		uri = uri.substring(1);
	}
	return uri;
}

export function resolve(root: string, file: string): string {
	if (!strict || os.platform() != 'win32') {
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
	/(^|\/)tsd\.d\.ts($|\/)/,
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
			return true
		}
	}
	return false;
}

export function isDependencyFile(filename: string): boolean {
	return filename.startsWith("node_modules/") || filename.indexOf("/node_modules/") !== -1;
}

export function isDeclarationFile(filename: string): boolean {
	return filename.endsWith(".d.ts");
}

/**
 * Converts filename to POSIX-style absolute one if filename does not denote absolute path already
 */
export function absolutize(filename: string) {
	filename = normalizePath(filename);
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
