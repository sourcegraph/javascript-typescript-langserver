
import * as path from "path";

import * as ts from "typescript";
import { SymbolKind, Range, Position} from 'vscode-languageserver';

export function formHover(info: ts.QuickInfo): string {
    return info ? `{${info.kind}, ${info.documentation}}` : "";
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

export function formExternalUri(external) {
    return external.repoName + "$" + external.repoURL + "$" + external.repoCommit + "$" + external.path;
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

