"use strict";
const os = require("os");
const path = require("path");
const ts = require("typescript");
const vscode_languageserver_1 = require("vscode-languageserver");
var strict = false;
/**
 * Toggles "strict" flag, affects how we are parsing/generating URLs.
 * In strict mode we using "file://PATH", otherwise on Windows we are using "file:///PATH"
 */
function setStrict(value) {
    strict = value;
}
exports.setStrict = setStrict;
function formEmptyRange() {
    return vscode_languageserver_1.Range.create(vscode_languageserver_1.Position.create(0, 0), vscode_languageserver_1.Position.create(0, 0));
}
exports.formEmptyRange = formEmptyRange;
function formEmptyPosition() {
    return vscode_languageserver_1.Position.create(0, 0);
}
exports.formEmptyPosition = formEmptyPosition;
function formEmptyKind() {
    return 3 /* Namespace */;
}
exports.formEmptyKind = formEmptyKind;
/**
 * Makes documentation string from symbol display part array returned by TS
 */
function docstring(parts) {
    return ts.displayPartsToString(parts);
}
exports.docstring = docstring;
/**
 * Normalizes path to match POSIX standard (slashes)
 */
function normalizePath(file) {
    return file.replace(new RegExp('\\' + path.sep, 'g'), path.posix.sep);
}
exports.normalizePath = normalizePath;
function convertStringtoSymbolKind(kind) {
    switch (kind) {
        case "file": return 1 /* File */;
        case "module": return 2 /* Module */;
        case "namespace": return 3 /* Namespace */;
        case "package": return 4 /* Package */;
        case "class": return 5 /* Class */;
        case "method": return 6 /* Method */;
        case "property": return 7 /* Property */;
        case "field": return 8 /* Field */;
        case "constructor": return 9 /* Constructor */;
        case "enum": return 10 /* Enum */;
        case "interface": return 11 /* Interface */;
        case "function": return 12 /* Function */;
        case "variable": return 13 /* Variable */;
        case "constant": return 14 /* Constant */;
        case "string": return 15 /* String */;
        case "number": return 16 /* Number */;
        case "boolean": return 17 /* Boolean */;
        case "array": return 18 /* Array */;
        case "array": return 18 /* Array */;
        case "sourcefile": return 1 /* File */;
        default: return 15 /* String */;
    }
}
exports.convertStringtoSymbolKind = convertStringtoSymbolKind;
function path2uri(root, file) {
    let ret = 'file://';
    if (!strict && process.platform == 'win32') {
        ret += '/';
    }
    let p;
    if (root) {
        p = resolve(root, file);
    }
    else {
        p = file;
    }
    return ret + normalizePath(p);
}
exports.path2uri = path2uri;
function uri2path(uri) {
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
exports.uri2path = uri2path;
function uri2reluri(uri, root) {
    return path2uri('', uri2relpath(uri, root));
}
exports.uri2reluri = uri2reluri;
function uri2relpath(uri, root) {
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
exports.uri2relpath = uri2relpath;
function resolve(root, file) {
    if (!strict || os.platform() != 'win32') {
        return path.resolve(root, file);
    }
    else {
        return path.posix.resolve(root, file);
    }
}
exports.resolve = resolve;
let jstsPattern = /\.[tj]sx?$/;
function isJSTSFile(filename) {
    return jstsPattern.test(filename);
}
exports.isJSTSFile = isJSTSFile;
let jstsConfigPattern = /(^|\/)[tj]sconfig\.json$/;
function isConfigFile(filename) {
    return jstsConfigPattern.test(filename);
}
exports.isConfigFile = isConfigFile;
let packageJsonPattern = /(^|\/)package\.json$/;
function isPackageJsonFile(filename) {
    return packageJsonPattern.test(filename);
}
exports.isPackageJsonFile = isPackageJsonFile;
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
function isGlobalTSFile(filename) {
    for (const globalTSPattern of globalTSPatterns) {
        if (globalTSPattern.test(filename)) {
            return true;
        }
    }
    return false;
}
exports.isGlobalTSFile = isGlobalTSFile;
function isDependencyFile(filename) {
    return filename.startsWith("node_modules/") || filename.indexOf("/node_modules/") !== -1;
}
exports.isDependencyFile = isDependencyFile;
function isDeclarationFile(filename) {
    return filename.endsWith(".d.ts");
}
exports.isDeclarationFile = isDeclarationFile;
//# sourceMappingURL=util.js.map