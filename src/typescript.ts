/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Position, Range, Location } from 'vscode-languageserver';

import * as packages from './find-packages';
import * as util from './util';
import ExportedSymbolProvider from './exported-symbols-provider'

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
    exportedSymbolProvider: ExportedSymbolProvider;

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

        this.exportedSymbolProvider = new ExportedSymbolProvider(this);
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
            this.externalRefs = this.collectExternals(this.collectExternalLibs());
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

    collectExternalLibs() {
        let pkgFiles = packages.collectFiles(this.root + "/node_modules", ["node_modules"]);
        let pkgsInfo = pkgFiles.map(pkg => {
            return { name: pkg.package.name, repo: pkg.package.repository && pkg.package.repository.url, version: pkg.package._shasum }
        });
        return pkgsInfo;

    };

    collectExternals(externalLibs) {
        var self = this;
        var importRefs = [];

        for (const sourceFile of this.services.getProgram().getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib && sourceFile.fileName.indexOf("node_modules") == -1) {
                ts.forEachChild(sourceFile, collectImports);
                ts.forEachChild(sourceFile, collectImportedCalls);
            }
        }
        return importRefs;

        function collectImports(node: ts.Node) {
            // TODO: add support of "require('foo')" without declaring a variable  
            let sourceFile = node.getSourceFile();
            if (node.kind == ts.SyntaxKind.VariableDeclaration) {
                let decl = <ts.VariableDeclaration>node;
                if (decl.name.kind == ts.SyntaxKind.Identifier && decl.initializer && decl.initializer.kind == ts.SyntaxKind.CallExpression) {
                    let init = <ts.CallExpression>decl.initializer;
                    let name = <ts.Identifier>decl.name;
                    let fileName = sourceFile.fileName;
                    let argument = init.arguments[0];
                    if (init.expression.kind == ts.SyntaxKind.Identifier && init.expression['text'] == "require"
                        && argument.kind == ts.SyntaxKind.StringLiteral) {
                        let libRes = externalLibs.find(lib => {
                            if (lib.name == argument['text']) {
                                return true;
                            }
                        });
                        if (libRes) {
                            let libName = argument['text'];
                            let posInFile = name.getStart(sourceFile);
                            let refs: ts.ReferenceEntry[] = self.services.getReferencesAtPosition(sourceFile.fileName, posInFile);
                            if (refs) {
                                refs.forEach(ref => {
                                    let newRef = {
                                        name: name.text, path: libName, file: ref.fileName, start: ref.textSpan.start,
                                        len: ref.textSpan.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                    };
                                    importRefs.push(newRef);
                                });
                            } else {
                                let newRef = {
                                    name: name.text, path: libName, file: fileName, start: posInFile,
                                    len: name.text.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                };
                                importRefs.push(newRef);
                            }
                        }
                    }
                } else if (decl.name.kind == ts.SyntaxKind.Identifier && decl.initializer && decl.initializer.kind == ts.SyntaxKind.PropertyAccessExpression) {
                    let init = <ts.PropertyAccessExpression>decl.initializer;
                    let name = <ts.Identifier>decl.name;
                    let fileName = sourceFile.fileName;
                    let importedName = init.name;
                    if (init.expression.kind == ts.SyntaxKind.CallExpression) {
                        let call = <ts.CallExpression>init.expression;
                        let expr = call.expression;
                        let argument = call.arguments[0];
                        if (expr.kind == ts.SyntaxKind.Identifier && expr['text'] == "require" && argument.kind == ts.SyntaxKind.StringLiteral) {
                            let libRes = externalLibs.find(lib => {
                                if (lib.name == argument['text']) {
                                    return true;
                                }
                            });

                            if (libRes) {
                                let libName = argument['text'];
                                let posInFile = name.getStart(sourceFile);
                                let refs: ts.ReferenceEntry[] = self.services.getReferencesAtPosition(sourceFile.fileName, posInFile);
                                if (refs) {
                                    refs.forEach(ref => {
                                        let path = importedName && importedName.kind == ts.SyntaxKind.Identifier ? `${libName}.${importedName['text']}` : libName;
                                        let newRef = {
                                            name: name.text, path: libName, file: ref.fileName, start: ref.textSpan.start,
                                            len: ref.textSpan.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                        };
                                        importRefs.push(newRef);
                                    });
                                } else {
                                    console.error("hereeree  = ", posInFile);
                                    let path = importedName && importedName.kind == ts.SyntaxKind.Identifier ? `${libName}.${importedName['text']}` : libName;
                                    let newRef = {
                                        name: name.text, path: libName, file: fileName, start: posInFile,
                                        len: name.text.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                    };
                                    importRefs.push(newRef);
                                }
                            }
                        }
                    }

                }
            } else if (node.kind == ts.SyntaxKind.ImportDeclaration) {
                let decl = <ts.ImportDeclaration>node;
                if (decl.importClause && decl.importClause.namedBindings) {
                    let libRes = externalLibs.find(lib => {
                        if (lib.name == decl.moduleSpecifier['text']) {
                            return true;
                        }
                    });
                    if (libRes) {
                        let fileName = sourceFile.fileName;
                        let libName = decl.moduleSpecifier['text'];
                        let namedBindings = decl.importClause.namedBindings;
                        if (namedBindings.kind === ts.SyntaxKind.NamespaceImport) {
                            let namespaceImport = <ts.NamespaceImport>namedBindings;
                            if (namespaceImport.name) {
                                let posInFile = namespaceImport.name.getStart(sourceFile);
                                let refs: ts.ReferenceEntry[] = self.services.getReferencesAtPosition(sourceFile.fileName, posInFile);
                                if (refs) {
                                    refs.forEach(ref => {
                                        let newRef = {
                                            name: namespaceImport.name.text, path: libName, file: ref.fileName, start: ref.textSpan.start,
                                            len: ref.textSpan.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                        };
                                        importRefs.push(newRef);
                                    });
                                } else {
                                    let newRef = {
                                        name: namespaceImport.name.text, path: libName, file: fileName, start: posInFile,
                                        len: namespaceImport.name.text.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                    };
                                    importRefs.push(newRef);
                                }
                            }
                        } else if (namedBindings.kind === ts.SyntaxKind.NamedImports) {
                            let namedImports = <ts.NamedImports>namedBindings;
                            for (const namedImport of namedImports.elements) {
                                let posInFile = namedImport.name.getStart(sourceFile);
                                let pathName = namedImport.propertyName ? namedImport.propertyName['text'] : namedImport.name['text'];
                                let refs: ts.ReferenceEntry[] = self.services.getReferencesAtPosition(sourceFile.fileName, posInFile);
                                if (refs) {
                                    refs.forEach(ref => {
                                        let newRef = {
                                            name: pathName, path: `${libName}.${pathName}`, file: ref.fileName, start: ref.textSpan.start,
                                            len: ref.textSpan.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                        };
                                        importRefs.push(newRef);
                                    });
                                } else {
                                    let newRef = {
                                        name: pathName, path: `${libName}.${pathName}`, file: fileName, start: posInFile,
                                        len: pathName.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                    };
                                    importRefs.push(newRef);
                                }
                            }
                        }
                    }
                }
            }
            ts.forEachChild(node, collectImports);
        }

        function collectImportedCalls(node: ts.Node) {
            if (node.kind == ts.SyntaxKind.PropertyAccessExpression) {
                var ids = [];
                ts.forEachChild(node, collectIds);
                function collectIds(node: ts.Node) {
                    if (node.kind == ts.SyntaxKind.Identifier) {
                        ids.push(node);
                    }
                    ts.forEachChild(node, collectIds);
                }

                let idsRes = ids.map((id, index) => {
                    let pos = id.end - id.text.length;
                    let importRes = importRefs.find(ref => {
                        if (ref.file == id.getSourceFile().fileName && ref.start == pos) {
                            return true;
                        }
                    });

                    if (importRes) {
                        return { index: index, import: importRes };
                    }
                });

                let res = idsRes.find(idRes => {
                    if (idRes) {
                        return true;
                    }
                });

                if (res) {
                    //elements here access present properties chain from import
                    let startPath = res.import.path;
                    for (let i = res.index + 1; i < ids.length; i++) {
                        let id = ids[i];
                        startPath = `${startPath}.${id.text}`;
                        let pos = id.end - id.text.length;
                        importRefs.push({
                            name: id.text, path: startPath, file: id.getSourceFile().fileName, pos: pos,
                            len: id.text.length, repoName: res.import.repoName, repoURL: res.import.repoURL, repoCommit: res.import.repoCommit
                        })
                    }
                }
            } else if (node.kind != ts.SyntaxKind.ImportDeclaration) {
                ts.forEachChild(node, collectImportedCalls);
            }
        }
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
            this.topLevelDecls = this.collectTopLevelInterface();
        }
        return this.topLevelDecls;

    }

    collectTopLevelInterface() {
        let decls = [];
        let self = this;
        for (const sourceFile of this.services.getProgram().getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib && sourceFile.fileName.indexOf("node_modules") == -1) {
                sourceFile.getChildren().forEach(child => {
                    collectTopLevelDeclarations(child, true);
                });
            }
        }

        return decls;

        function processNamedDeclaration(node: ts.Node, analyzeChildren, parentPath?: string) {
            if (util.isNamedDeclaration(node)) {
                let sourceFile = node.getSourceFile();
                let fileName = sourceFile.fileName;
                let decl = <ts.Declaration>node;
                let name = <ts.Identifier>decl.name;
                let range = Range.create(self.getLineAndPosFromOffset(fileName, name.getStart(sourceFile)), self.getLineAndPosFromOffset(fileName, name.getEnd()));
                let path = parentPath ? `${parentPath}.${name.text}` : name.text;
                decls.push({
                    name: decl.name['text'],
                    kind: util.getNamedDeclarationKind(node),
                    path: path,
                    location: {
                        file: fileName,
                        range: range
                    },
                });
                if (analyzeChildren) {
                    node.getChildren().forEach(child => {
                        collectTopLevelDeclarations(child, false, path);
                    });
                }
            }
        }

        function collectTopLevelDeclarations(node: ts.Node, analyzeChildren, parentPath?: string) {
            let sourceFile = node.getSourceFile();
            let fileName = sourceFile.fileName;
            if (node.kind == ts.SyntaxKind.SyntaxList) {
                node.getChildren().forEach(child => {
                    collectTopLevelDeclarations(child, true);
                });
            } else if (node.kind == ts.SyntaxKind.VariableStatement) {
                let stmt = <ts.VariableStatement>node;
                if (stmt.declarationList) {
                    let varDecls = stmt.declarationList.declarations;
                    if (varDecls) {
                        varDecls.forEach(varDecl => {
                            processNamedDeclaration(varDecl, analyzeChildren, parentPath);
                        });
                    }
                }
            } else {
                processNamedDeclaration(node, analyzeChildren, parentPath);
            }
        }
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
        const fileName: string = this.uri2path(uri);
        if (!this.files[fileName]) {
            return null;
        }
        const offset: number = this.offset(fileName, line, column);
        // return this.services.findReferences(fileName, offset);
        return this.services.getReferencesAtPosition(fileName, offset);
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
        let lines: number[] = this.getLines(fileName)
        return lines[line - 1] + column - 1
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
