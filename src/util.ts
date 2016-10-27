import * as path from "path";

import * as ts from "typescript";
import { SymbolKind, Range, Position} from 'vscode-languageserver';

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
    return external.repoName ? external.repoName + "$" + external.repoURL + "$" + external.repoCommit + "$" + external.path
        : external.path;
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

export function isNamedDeclaration(node): boolean {
    if (node.name && node.name.kind == ts.SyntaxKind.Identifier) {
        if (node.kind == ts.SyntaxKind.MethodDeclaration) {
            return true;
        }
        if (node.kind == ts.SyntaxKind.FunctionDeclaration) {
            return true;
        }
        if (node.kind == ts.SyntaxKind.ClassDeclaration) {
            return true;
        }
        if (node.kind == ts.SyntaxKind.VariableDeclaration) {
            return true;
        }
        if (node.kind == ts.SyntaxKind.EnumDeclaration) {
            return true;
        }
        if (node.kind == ts.SyntaxKind.InterfaceDeclaration) {
            return true;
        }
    }
    return false;
}

export function getNamedDeclarationKind(node) {
    if (node.name && node.name.kind == ts.SyntaxKind.Identifier) {
        if (node.kind == ts.SyntaxKind.MethodDeclaration) {
            return SymbolKind.Method;
        }
        if (node.kind == ts.SyntaxKind.FunctionDeclaration) {
            return SymbolKind.Function;
        }
        if (node.kind == ts.SyntaxKind.ClassDeclaration) {
            return SymbolKind.Class;
        }
        if (node.kind == ts.SyntaxKind.VariableDeclaration) {
            return SymbolKind.Variable;
        }
        if (node.kind == ts.SyntaxKind.EnumDeclaration) {
            return SymbolKind.Enum;
        }
        if (node.kind == ts.SyntaxKind.InterfaceDeclaration) {
            return SymbolKind.Interface;
        }
    }
    return SymbolKind.String;
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

export function collectAllParents(node, parents) {
    if (node.parent) {
        parents.push(node.parent);
        return collectAllParents(node.parent, parents);
    } else {
        return parents;
    }
}

// function collectAllComments(node) {
//     node.getChildren().forEach(child => {
//         let comments1 = (ts as any).getLeadingCommentRanges(child.getSourceFile().getFullText(), child.getFullStart());
//         let comments2 = (ts as any).getTrailingCommentRanges(child.getSourceFile().getFullText(), child.getEnd());
//         if (comments1) {
//             console.error("node kind = ", child.kind);
//             console.error("node start = ", child.getStart());
//             console.error('comment = ', child.getSourceFile().getFullText().substring(comments1[0].pos, comments1[0].end));
//             // console.error("docs1 = ", comments1);

//         }

//         // console.error("docs2 = ", comments2);
//         this.collectAllComments(child);
//     });
// }

export function path2uri(root, file: string): string {
    let ret = 'file://';
    if (process.platform == 'win32') {
        ret += '/';
    }
    let p = root ? path.resolve(root, file) : file;
    return ret + normalizePath(p);
}

export function uri2path(uri: string): string {
    if (uri.startsWith('file://')) {
        uri = uri.substring(7);
        if (process.platform == 'win32') {
            uri = uri.substring(1).replace(/%3A/g, ':');
        }
    }
    return uri;
}

export function uri2reluri(uri, root: string): string {
    return path2uri('', uri2relpath(uri, root));
}

export function uri2relpath(uri, root: string): string {
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

