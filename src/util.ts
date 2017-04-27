import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { Position, Range, SymbolKind } from 'vscode-languageserver';
import { URL } from 'whatwg-url';
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
		case 'module': return SymbolKind.Module;
		case 'class': return SymbolKind.Class;
		case 'local class': return SymbolKind.Class;
		case 'interface': return SymbolKind.Interface;
		case 'enum': return SymbolKind.Enum;
		case 'enum member': return SymbolKind.Constant;
		case 'var': return SymbolKind.Variable;
		case 'local var': return SymbolKind.Variable;
		case 'function': return SymbolKind.Function;
		case 'local function': return SymbolKind.Function;
		case 'method': return SymbolKind.Method;
		case 'getter': return SymbolKind.Method;
		case 'setter': return SymbolKind.Method;
		case 'property': return SymbolKind.Property;
		case 'constructor': return SymbolKind.Constructor;
		case 'parameter': return SymbolKind.Variable;
		case 'type parameter': return SymbolKind.Variable;
		case 'alias': return SymbolKind.Variable;
		case 'let': return SymbolKind.Variable;
		case 'const': return SymbolKind.Constant;
		case 'JSX attribute': return SymbolKind.Property;
		// case 'script'
		// case 'keyword'
		// case 'type'
		// case 'call'
		// case 'index'
		// case 'construct'
		// case 'primitive type'
		// case 'label'
		// case 'directory'
		// case 'external module name'
		// case 'external module name'
		default: return SymbolKind.Variable;
	}
}

/**
 * Returns the given file path as a URL.
 * The returned URL uses protocol and host of the passed root URL
 */
export function path2uri(rootUri: URL, filePath: string): URL {
	const parts = filePath.split('/');
	const isWindowsUri = parts[0].includes(':');
	// Don't encode colon after Windows drive letter
	if (isWindowsUri) {
		parts[0] = '/' + parts[0];
	} else {
		parts[0] = encodeURIComponent(parts[0]);
	}
	// Encode all other parts
	for (let i = 1; i < parts.length; i++) {
		parts[i] = encodeURIComponent(parts[i]);
	}
	const pathname = parts.join('/');
	return new URL(pathname, rootUri.href);
}

/**
 * Returns the path component of the passed URI as a file path.
 * The OS style and seperator is determined by the presence of a Windows drive letter + colon in the URI.
 * Does not check the URI protocol.
 */
export function uri2path(uri: URL): string {
	// %-decode parts
	const parts = uri.pathname.split('/').map(part => {
		try {
			return decodeURIComponent(part);
		} catch (err) {
			throw new Error(`Error decoding ${part} of ${uri}: ${err.message}`);
		}
	});
	// Strip the leading slash on Windows
	const isWindowsUri = parts[0] && /^\/[a-z]:\//.test(parts[0]);
	if (isWindowsUri) {
		parts[0] = parts[0].substr(1);
	}
	return parts.join(isWindowsUri ? '\\' : '/');
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
	/node_modules\/(?:\@|%40)types\/node\/.*/,
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
		containerName: (d.containerName ? stripFileInfo(lastDotCmp(stripQuotes(d.containerName))) : '')
	};
}

export function symbolDescriptorMatch(query: Partial<rt.SymbolDescriptor>, sym: rt.SymbolDescriptor): boolean {
	for (const key of Object.keys(query)) {
		if ((query as any)[key] === undefined) {
			continue;
		}
		if (key === 'package') {
			if (!sym.package || !packageDescriptorMatch(query.package!, sym.package)) {
				return false;
			}
			continue;
		}
		if ((query as any)[key] !== (sym as any)[key]) {
			return false;
		}
	}
	return true;
}

function packageDescriptorMatch(query: rt.PackageDescriptor, sym: rt.PackageDescriptor): boolean {
	for (const key of Object.keys(query)) {
		if ((query as any)[key] === undefined) {
			continue;
		}
		if ((query as any)[key] !== (sym as any)[key]) {
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

/**
 * Strips file part (if any) from container name (last component of container path)
 * For example TS may return the following name: /node_modules/vscode-jsonrpc/lib/cancellation.
 * We consider that if name contains path separtor then container name is empty
 * @param containerName
 */
function stripFileInfo(containerName: string): string {
	return toUnixPath(containerName).indexOf('/') < 0 ? containerName : '';
}
