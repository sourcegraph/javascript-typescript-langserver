/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Position, Range, Location } from 'vscode-languageserver';

import * as packages from './find-packages';
import * as util from './util';

import ExportedSymbolsProvider from './exported-symbols-provider'
import ExternalRefsProvider from './external-refs-provider';
import WorkspaceSymbolsProvider from './workspace-symbols-provider';

var sanitizeHtml = require('sanitize-html');
var JSONPath = require('jsonpath-plus');

const pathDelimiter = "$";

export default class TypeScriptService {
    services: ts.LanguageService
    files: ts.Map<{ version: number }>
    root: string
    lines: ts.Map<number[]>
    externalRefs = null;
    exportedEnts = null;
    topLevelDecls = null;
    exportedSymbolProvider: ExportedSymbolsProvider;
    externalRefsProvider: ExternalRefsProvider;
    workspaceSymbolProvider: WorkspaceSymbolsProvider;

    envDefs = [];

    constructor(root: string) {
        this.root = root;
        this.files = {};
        this.lines = {};
        const allFiles: string[] = this.collectFiles(root);

        // initialize the list of files
        allFiles.forEach(fileName => {
            this.files[fileName] = { version: 0 };
        });

        // const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES6, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React };
        const options: ts.CompilerOptions = { module: ts.ModuleKind.CommonJS, allowNonTsExtensions: true, allowJs: true };
        const defPath = path.join(__dirname, '../src/defs/merged.lib.d.ts');

        // Create the language service host to allow the LS to communicate with the host
        const servicesHost: ts.LanguageServiceHost = {
            getScriptFileNames: () => allFiles,
            getScriptVersion: (fileName) => this.files[fileName] && this.files[fileName].version.toString(),
            getScriptSnapshot: (fileName) => {
                const fullPath = this.resolvePath(fileName);
                if (!fs.existsSync(fullPath)) {
                    return undefined;
                }

                return ts.ScriptSnapshot.fromString(fs.readFileSync(fullPath).toString());
            },
            getCurrentDirectory: () => root,
            getCompilationSettings: () => options,
            // getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            getDefaultLibFileName: (options) => defPath,
        };

        // Create the language service files
        this.services = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
        this.initEnvDefFiles();

        //initialize providers 
        this.exportedSymbolProvider = new ExportedSymbolsProvider(this);
        this.externalRefsProvider = new ExternalRefsProvider(this);
        this.workspaceSymbolProvider = new WorkspaceSymbolsProvider(this);
    }

    initEnvDefFiles() {
        try {
            this.envDefs.push(JSON.parse(fs.readFileSync(path.join(__dirname, '../src/defs/node.json'), 'utf8')));
            this.envDefs.push(JSON.parse(fs.readFileSync(path.join(__dirname, '../src/defs/ecmascript.json'), 'utf8')));
        } catch (error) {
            console.error("error = ", error);
        }
    }

    lookupEnvDef(property, container) {
        let results = [];
        if (this.envDefs && this.envDefs.length > 0) {
            this.envDefs.forEach(envDef => {
                let res = JSONPath({ json: envDef, path: `$..${property}` });
                if (res) {
                    results = results.concat(res);
                }
            });
        }

        if (results.length > 1) {
            let result = results.find(info => {
                if (info['!url'] && container && info['!url'].indexOf(container) > -1) {
                    return true;
                }
            });
            return result ? result : results[0];
        }

        if (results) {
            return results[0];
        }
    }

    getPathForPosition(uri: string, line: number, column: number): string[] {
        const fileName: string = this.uri2path(uri);
        if (!this.files[fileName]) {
            return [];
        }
        const offset: number = this.offset(fileName, line, column);
        let defs = this.services.getDefinitionAtPosition(fileName, offset);
        let paths = [];

        if (defs) {
            defs.forEach(def => {
                let pathRes = def.fileName;
                if (def.name && def.containerName) {
                    pathRes = `${pathRes}${pathDelimiter}${def.containerName}${pathDelimiter}${def.name}`
                } else {
                    let sourceFile = this.services.getSourceFile(def.fileName);
                    let foundNode = (ts as any).getTouchingToken(sourceFile, def.textSpan.start);
                    let allParents = util.collectAllParents(foundNode, []).filter(parent => {
                        return util.isNamedDeclaration(parent);
                    });

                    allParents.forEach(parent => {
                        pathRes = `${pathRes}${pathDelimiter}${parent.name.text}`
                    });
                    if (util.isNamedDeclaration(foundNode)) {
                        pathRes = `${pathRes}${pathDelimiter}${foundNode.name.text}`
                    }
                }

                paths.push(pathRes);
            });
        } else {
            let sourceFile = this.services.getSourceFile(fileName);
            let foundNode = (ts as any).getTouchingToken(sourceFile, offset);
            let allParents = util.collectAllParents(foundNode, []).filter(parent => {
                return util.isNamedDeclaration(parent);
            });
            let pathRes = fileName;
            allParents.forEach(parent => {
                pathRes = `${pathRes}${pathDelimiter}${parent.name.text}`
            });
            if (util.isNamedDeclaration(foundNode)) {
                pathRes = `${pathRes}${pathDelimiter}${foundNode.name.text}`
            }
            paths.push(pathRes);
        }
        return paths;
    }

    getPositionForPath(path: string) {
        let resNodes = [];
        function traverseNodeChain(node, parts) {
            if (!node) {
                return;
            }

            node.getChildren().forEach(child => {
                if (util.isNamedDeclaration(child)) {
                    let name = <ts.Identifier>child.name.text;
                    let partName = parts[0];
                    if (name == partName) {
                        let restParts = parts.slice(1);
                        if (restParts.length == 0) {
                            resNodes.push(child);
                            return;
                        } else {
                            traverseNodeChain(child, restParts);
                        }
                    }
                } else {
                    traverseNodeChain(child, parts);
                }
            });
        }

        var parts = path.split(pathDelimiter);
        let fileName = parts[0];
        let sourceFile = this.services.getSourceFile(fileName);
        traverseNodeChain(sourceFile, parts.slice(1));
        let res = [];
        if (resNodes.length > 0) {
            resNodes.forEach(resNode => {
                let file: ts.SourceFile = resNode.getSourceFile();
                let posStart = resNode.getStart(file);
                let posEnd = resNode.getEnd();
                res.push({ fileName: file.fileName, start: posStart, end: posEnd });
            });
        }
        return res;
    }

    getExternalRefs() {
        if (this.externalRefs === null) {
            this.externalRefs = this.externalRefsProvider.collectExternals();
        }
        return this.externalRefs;
    }

    getExportedEnts() {
        if (this.exportedEnts === null) {
            this.exportedEnts = this.exportedSymbolProvider.collectExportedEntities();
        }
        return this.exportedEnts;
    }

    doc(node: ts.Node): string {
        let text = node.getSourceFile().getFullText();
        let comments1 = (ts as any).getLeadingCommentRanges(text, node.getFullStart());
        let comments2 = (ts as any).getTrailingCommentRanges(text, node.getEnd());
        let comments = [];
        if (!comments1 && !comments2) {
            let parents = util.collectAllParents(node, []);
            for (let i = 0; i < parents.length; i++) {
                let parent = parents[i];
                let comments1 = (ts as any).getLeadingCommentRanges(text, parent.getFullStart());
                let comments2 = (ts as any).getTrailingCommentRanges(text, parent.getEnd());
                if (comments1) {
                    comments = comments.concat(comments1);
                }
                if (comments2) {
                    comments = comments.concat(comments2);
                }
                if (comments1 || comments2) break;
            }
        } else {
            comments = comments1 || comments2;
        }

        let res = "";
        if (comments) {
            comments.forEach(comment => {
                res = res + sanitizeHtml(`<p>${text.substring(comment.pos + 2, comment.end)}</p>`);
            });
        }
        return res;
    }

    getDefinition(uri: string, line: number, column: number): ts.DefinitionInfo[] {
        const fileName: string = this.uri2path(uri);
        if (!this.files[fileName]) {
            return [];
        }
        const offset: number = this.offset(fileName, line, column);
        let defs = this.services.getDefinitionAtPosition(fileName, offset);
        if (defs) {
            defs.forEach(def => {
                let fileName = def.fileName;
                let name = def.name;
                let container = def.containerName.toLowerCase();
                if (fileName.indexOf("merged.lib.d.ts") > -1) {
                    let result = this.lookupEnvDef(name, container);
                    if (result) {
                        def['url'] = result['!url'];
                    }
                }
            });
        }

        return defs;
    }

    getExternalDefinition(uri: string, line: number, column: number) {
        const fileName: string = this.uri2path(uri);
        if (!this.files[fileName]) {
            return;
        }
        const offset: number = this.offset(fileName, line, column);
        let externalRes = this.getExternalRefs().find(ref => {
            if (ref.file == fileName && ref.pos == offset) {
                return true;
            }
        });

        return externalRes;
    }

    getTopLevelDeclarations() {
        if (this.topLevelDecls === null) {
            this.topLevelDecls = this.workspaceSymbolProvider.collectTopLevelInterface();
        }
        return this.topLevelDecls;

    }


    getHover(uri: string, line: number, column: number): ts.QuickInfo {
        const fileName: string = this.uri2path(uri);

        if (!this.files[fileName]) {
            return null;
        }

        const offset: number = this.offset(fileName, line, column);
        return this.services.getQuickInfoAtPosition(fileName, offset);
    }

    getReferences(uri: string, line: number, column: number): ts.ReferenceEntry[] {
        try {
            const fileName: string = this.uri2path(uri);
            if (!this.files[fileName]) {
                return null;
            }
            const offset: number = this.offset(fileName, line, column);
           
            return this.services.getReferencesAtPosition(fileName, offset);
        } catch (exc) {
            console.error("Exception occcurred = ", exc);
        }
    }

    position(fileName: string, offset: number): Position {
        let lines: number[] = this.getLines(fileName)
        let index: number = this.getLine(offset, lines)
        return {
            line: index + 1,
            character: offset - lines[index] + 1
        }
    }

    private getLine(offset: number, lines: number[]): number {
        let lo: number = 0
        let hi: number = lines.length
        while (lo != hi) {
            let mid: number = (lo + hi) / 2
            if (lines[mid] <= offset) {
                lo = mid + 1
            } else {
                hi = mid
            }
        }
        return lo - 1
    }

    private collectFiles(root: string): string[] {
        var files: string[] = [];
        this.getFiles(root, '', files);
        return files;
    }

    private getFiles(root: string, prefix: string, files: string[]) {
        const dir: string = path.join(root, prefix)
        const self = this
        if (!fs.existsSync(dir)) {
            return
        }
        if (fs.statSync(dir).isDirectory()) {
            fs.readdirSync(dir).filter(function (name) {
                if (name[0] == '.') {
                    return false;
                }
                if (name == 'node_modules') {
                    return false;
                }
                return name.endsWith('.ts') || name.endsWith('.js') || fs.statSync(path.join(dir, name)).isDirectory();
            }).forEach(function (name) {
                self.getFiles(root, path.posix.join(prefix, name), files)
            })
        } else {
            files.push(prefix)
        }
    }

    getLineAndPosFromOffset(fileName: string, offset: number): Position {
        let lines: number[] = this.getLines(fileName);
        let res = util.formEmptyPosition();
        lines.find((el, index) => {
            if (offset <= el) {
                res = Position.create(index, offset - lines[index - 1]);
                return true;
            }
        });
        return res;

    }

    private offset(fileName: string, line: number, column: number): number {
        try {
            let lines: number[] = this.getLines(fileName)
            return lines[line - 1] + column - 1
        } catch (exc) {
            console.error("inside offset catch = ", exc);
        }
    }

    private getLines(fileName: string) {
        let lines: number[] = this.lines[fileName]
        if (!lines) {
            lines = this.computeLineStarts(fs.readFileSync(this.resolvePath(fileName), 'utf-8'))
            this.lines[fileName] = lines
        }
        return lines
    }

    private computeLineStarts(text: string): number[] {
        const result: number[] = [];
        let pos = 0;
        let lineStart = 0;
        while (pos < text.length) {
            const ch = text.charCodeAt(pos);
            pos++;
            switch (ch) {
                case 0xD:
                    if (text.charCodeAt(pos) === 0xA) {
                        pos++;
                    }
                case 0xA:
                    result.push(lineStart);
                    lineStart = pos;
                    break;
            }
        }
        result.push(lineStart);
        return result;
    }

    private uri2path(uri: string) {
        if (!uri.startsWith('file:///')) {
            return null;
        }
        return uri.substring('file:///'.length);
    }

    private resolvePath(p: string): string {
        return path.resolve(this.root, p);
    }
}
