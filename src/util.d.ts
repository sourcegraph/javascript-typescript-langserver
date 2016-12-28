import * as ts from "typescript";
import { SymbolKind, Range, Position } from 'vscode-languageserver';
/**
 * Toggles "strict" flag, affects how we are parsing/generating URLs.
 * In strict mode we using "file://PATH", otherwise on Windows we are using "file:///PATH"
 */
export declare function setStrict(value: boolean): void;
export declare function formEmptyRange(): Range;
export declare function formEmptyPosition(): Position;
export declare function formEmptyKind(): number;
/**
 * Makes documentation string from symbol display part array returned by TS
 */
export declare function docstring(parts: ts.SymbolDisplayPart[]): string;
/**
 * Normalizes path to match POSIX standard (slashes)
 */
export declare function normalizePath(file: string): string;
export declare function convertStringtoSymbolKind(kind: string): SymbolKind;
export declare function path2uri(root: string, file: string): string;
export declare function uri2path(uri: string): string;
export declare function uri2reluri(uri: string, root: string): string;
export declare function uri2relpath(uri: string, root: string): string;
export declare function resolve(root: string, file: string): string;
export declare function isJSTSFile(filename: string): boolean;
export declare function isConfigFile(filename: string): boolean;
export declare function isPackageJsonFile(filename: string): boolean;
export declare function isGlobalTSFile(filename: string): boolean;
export declare function isDependencyFile(filename: string): boolean;
export declare function isDeclarationFile(filename: string): boolean;
