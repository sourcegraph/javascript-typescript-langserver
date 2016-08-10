/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
    Position
} from 'vscode-languageserver';

import * as packages from './find-packages';
import * as util from './util';

export default class TypeScriptService {
    services: ts.LanguageService
    files: ts.Map<{ version: number }>
    root: string
    lines: ts.Map<number[]>
    externalRefs = [];
    exportedEnts = [];

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

        // Create the language service host to allow the LS to communicate with the host
        const servicesHost: ts.LanguageServiceHost = {
            getScriptFileNames: () => allFiles,
            getScriptVersion: (fileName) => this.files[fileName] && this.files[fileName].version.toString(),
            getScriptSnapshot: (fileName) => {
                const fullPath = path.join(this.root, fileName)
                if (!fs.existsSync(fullPath)) {
                    return undefined;
                }

                return ts.ScriptSnapshot.fromString(fs.readFileSync(fullPath).toString());
            },
            getCurrentDirectory: () => root,
            getCompilationSettings: () => options,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        };

        // Create the language service files
        this.services = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());

        // this.externalRefs = this.collectExternals(this.collectExternalLibs());
        // console.error("externalRefs = ", this.externalRefs);
        // this.exportedEnts = this.collectExportedEntities();
        // console.error("exportedEnts = ", this.exportedEnts);
    }

    getExternalRefs() {
        if (!this.externalRefs || this.externalRefs.length == 0) {
            this.externalRefs = this.collectExternals(this.collectExternalLibs());
        }
        return this.externalRefs;
    }

    getExportedEnts() {
        if (!this.exportedEnts || this.exportedEnts.length == 0) {
            this.exportedEnts = this.collectExportedEntities();
        }
        return this.collectExportedEntities;
    }

    collectExportedEntities() {
        let exportedRefs = [];
        let pkgInfo = findCurrentProjectInfo();

        function findCurrentProjectInfo() {
            let pkgFiles = packages.collectFiles(this.root, ["node_modules"]);
            let pkgInfo = pkgFiles.find(function (pkg) {
                return this.root == path.dirname(pkg.path) + "/";
            });

            return pkgInfo;
        }

        function collectExports(node: ts.Node) {
            if (node.kind == ts.SyntaxKind.FunctionDeclaration) {
                if ((node.flags & ts.NodeFlags.Export) != 0) {
                    let decl = <ts.FunctionDeclaration>node;
                    let path = `${pkgInfo['package'].name}.${decl.name.text}`;
                    exportedRefs.push({ path: path, location: { file: node.getSourceFile().fileName, pos: decl.name.pos, end: decl.name.end } });
                }
            } else if (node.kind == ts.SyntaxKind.VariableDeclaration) {
                if ((node.flags & ts.NodeFlags.Export) != 0) {
                    let decl = <ts.VariableDeclaration>node;
                    if (decl.name.kind == ts.SyntaxKind.Identifier) {
                        let name = <ts.Identifier>decl.name;
                        let path = `${pkgInfo['package'].name}.${name.text}`;
                        exportedRefs.push({ path: path, location: { file: node.getSourceFile().fileName, pos: name.pos, end: name.end } });
                    }
                }
            } else if (node.kind == ts.SyntaxKind.ClassDeclaration) {
                if ((node.flags & ts.NodeFlags.Export) != 0) {
                    let decl = <ts.ClassDeclaration>node;
                    let path = `${pkgInfo['package'].name}.${decl.name.text}`;
                    exportedRefs.push({ path: path, location: { file: node.getSourceFile().fileName, pos: decl.name.pos, end: decl.name.end } });

                    //TODO add collections for methods and vars
                }
            } else {
                ts.forEachChild(node, collectExports);
            }
        }

        for (const sourceFile of this.services.getProgram().getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib) {
                ts.forEachChild(sourceFile, collectExports);
            }
        }

        return exportedRefs;
    }

    collectExternalLibs() {
        let pkgFiles = packages.collectFiles(`${this.root}/node_modules`, ["node_modules"]);
        let pkgsInfo = pkgFiles.map(pkg => {
            return { name: pkg.package.name, repo: pkg.package.repository && pkg.package.repository.url, version: pkg.package._shasum }
        });
        return pkgsInfo;

    };

    collectExternals(externalLibs) {
        var self = this;
        var importRefs = [];

        for (const sourceFile of this.services.getProgram().getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib) {
                ts.forEachChild(sourceFile, collectImports);
                ts.forEachChild(sourceFile, collectImportedCalls);
            }
        }
        return importRefs;

        function collectImports(node: ts.Node) {
            if (node.kind == ts.SyntaxKind.ImportDeclaration) {
                let decl = <ts.ImportDeclaration>node;
                if (decl.importClause !== undefined && decl.importClause.namedBindings !== undefined) {
                    let libRes = externalLibs.find(lib => {
                        if (lib.name == decl.moduleSpecifier['text']) {
                            return true;
                        }
                    });

                    if (libRes) {
                        let libName = decl.moduleSpecifier['text'];
                        let namedBindings = decl.importClause.namedBindings;
                        if (namedBindings.kind === ts.SyntaxKind.NamespaceImport) {
                            let namespaceImport = <ts.NamespaceImport>namedBindings;
                            if (namespaceImport.name) {
                                let refs: ts.ReferenceEntry[] = self.services.getReferencesAtPosition(namespaceImport.getSourceFile().fileName, namespaceImport.name.pos + 1);
                                refs.forEach(ref => {
                                    var newRef = {
                                        name: namespaceImport.name.text, path: `${libName}`, file: ref.fileName, start: ref.textSpan.start,
                                        len: ref.textSpan.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                    };
                                    importRefs.push(newRef);
                                });
                            }
                        } else if (namedBindings.kind === ts.SyntaxKind.NamedImports) {
                            let namedImports = <ts.NamedImports>namedBindings;
                            for (const namedImport of namedImports.elements) {
                                let pathName = namedImport.propertyName ? namedImport.propertyName['text'] : namedImport.name['text'];
                                let refs: ts.ReferenceEntry[] = self.services.getReferencesAtPosition(namedImport.getSourceFile().fileName, namedImport.name.pos + 1);
                                refs.forEach(ref => {
                                    var newRef = {
                                        name: pathName, path: `${libName}.${pathName}`, file: ref.fileName, start: ref.textSpan.start,
                                        len: ref.textSpan.length, repoName: libRes.name, repoURL: libRes.repo, repoCommit: libRes.version
                                    };
                                    importRefs.push(newRef);
                                });
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
        return this.services.getDefinitionAtPosition(fileName, offset);
    }

    getExternalDefinition(uri: string, line: number, column: number): string {
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

        if (externalRes) {
            // console.error("externalRes = ", externalRes);
            return util.formExternalUri(externalRes);
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
                return name.endsWith('.ts') || name.endsWith('.js') || name.endsWith('.json') || fs.statSync(path.join(dir, name)).isDirectory();
            }).forEach(function (name) {
                self.getFiles(root, path.posix.join(prefix, name), files)
            })
        } else {
            files.push(prefix)
        }
    }

    private normalizePath(file: string): string {
        return file.
            replace(new RegExp('\\' + path.sep, 'g'), path.posix.sep);
    }

    private offset(fileName: string, line: number, column: number): number {
        let lines: number[] = this.getLines(fileName)
        return lines[line - 1] + column - 1
    }

    private getLines(fileName: string) {
        let lines: number[] = this.lines[fileName]
        if (!lines) {
            lines = this.computeLineStarts(fs.readFileSync(path.join(this.root, fileName), 'utf-8'))
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


}
