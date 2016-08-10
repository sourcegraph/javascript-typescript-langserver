
import * as ts from "typescript";
import { SymbolKind, Range, Position} from 'vscode-languageserver';

export function formHover(info: ts.QuickInfo): string {
    return info ? `{${info.kind}, ${info.documentation}}` : "";
}

export function formEmptyRange(): Range {
    return Range.create(Position.create(0, 0), Position.create(0, 0))
}

export function formEmptyKind(): number {
    return SymbolKind.Namespace
}

export function formExternalUri(external) {
    return external.repoName + "$" + external.repoURL + "$" + external.repoCommit + "$" + external.path;

}