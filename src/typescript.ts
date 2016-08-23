/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
    Position, Range, Location
} from 'vscode-languageserver';

import * as packages from './find-packages';
import * as util from './util';

const pathDelimiter = "$";

export default class TypeScriptService {
    services: ts.LanguageService
    files: ts.Map<{ version: number }>
    root: string
    lines: ts.Map<number[]>
    externalRefs = null;
    exportedEnts = null;

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
                const fullPath = this.resolvePath(fileName);
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
    }

    getPathForPosition(uri: string, line: number, column: number): string[] {

        const fileName: string = this.uri2path(uri);
        if (!this.files[fileName]) {
            return [];
        }
        const offset: number = this.offset(fileName, line, column);
        let defs = this.services.getDefinitionAtPosition(fileName, offset);
        let paths = []
        if (defs) {
            defs.forEach(def => {
                let sourceFile = this.services.getSourceFile(def.fileName);
                let foundNode = (ts as any).getTouchingToken(sourceFile, def.textSpan.start);
                let allParents = util.collectAllParents(foundNode, []).filter(parent => {
                    return util.isNamedDeclaration(parent);
                });
                let pathRes = def.fileName;
                allParents.forEach(parent => {
                    pathRes = `${pathRes}${pathDelimiter}${parent.name.text}`
                });
                if (util.isNamedDeclaration(foundNode)) {
                    pathRes = `${pathRes}${pathDelimiter}${foundNode.name.text}`
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
            this.exportedEnts = this.collectExportedEntities();
        }
        return this.exportedEnts;
    }

    private doc(node: ts.Node): string {
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
                res = res + `<p>${text.substring(comment.pos + 2, comment.end)}</p>`
            });
        }

        return res;
    }

    collectExportedEntities() {
        let exportedRefs = [];
        let self = this;
        let allExports = [];
        let pkgMap = null;

        function findCurrentProjectInfo(fileName) {
            // (alexsaveliev) TypeScript returns lowercase path items
            if (pkgMap === null) {
                const packageDefs = packages.collectFiles(self.root, ["node_modules"]);
                pkgMap = new Map<string, any>();
                packageDefs.forEach(function (packageDef) {
                    const def = {
                        name: packageDef.package.name,
                        repo: packageDef.package.repository && packageDef.package.repository.url,
                        version: packageDef.package._shasum
                    };
                    packageDef.files.forEach(function (f) {
                        pkgMap.set(path.normalize(f).toLowerCase(), def);
                    });
                });
            }

            fileName = path.normalize(fileName).toLowerCase();
            return pkgMap.get(fileName) || {};
        }

        function processExportedName(name, node, pathInfo, text) {
            let sourceFile = node.getSourceFile();
            let fileName = sourceFile.fileName;
            let posInFile = name.getStart(sourceFile);
            let type = self.services.getTypeDefinitionAtPosition(fileName, posInFile);
            let kind = "";
            if (type && type.length > 0) {
                kind = type[0].kind;
            }

            let path = `${pathInfo}.${name.text}`;
            let range = Range.create(self.getLineAndPosFromOffset(fileName, posInFile), self.getLineAndPosFromOffset(fileName, name.getEnd()));
            allExports.push({ name: text || name.text, path: path });
            exportedRefs.push({
                name: name.text,
                kind: kind,
                path: path,
                location: {
                    file: fileName,
                    range: range
                },
                documentation: self.doc(node)
            });
        }

        function collectExportedChildDeclaration(node: ts.Node) {
            let sourceFile = node.getSourceFile();
            let fileName = sourceFile.fileName;
            let pkgInfo = findCurrentProjectInfo(sourceFile.path);
            if (node.kind == ts.SyntaxKind.Identifier) {
                let id = <ts.Identifier>node;
                if (node.parent.kind == ts.SyntaxKind.PropertyAccessExpression) {
                    let parent = <ts.PropertyAccessExpression>node.parent;
                    if (parent.expression.kind == ts.SyntaxKind.PropertyAccessExpression && parent.name.kind == ts.SyntaxKind.Identifier) {
                        let parentExpr = <ts.PropertyAccessExpression>parent.expression;
                        if (parentExpr.expression.kind == ts.SyntaxKind.Identifier && parentExpr.name.kind == ts.SyntaxKind.Identifier) {
                            if (parentExpr.name['text'] == "prototype") {
                                let res = allExports.find(elem => {
                                    if (elem.name == parentExpr.expression['text']) {
                                        return true;
                                    }
                                });
                                if (res) {
                                    let name = parent.name;
                                    processExportedName(name, node, res.path, name.text);
                                }
                            }
                        }
                    }
                }
            }
            ts.forEachChild(node, collectExportedChildDeclaration);
        }

        function collectExports(node: ts.Node, parentPath?: string) {
            let sourceFile = node.getSourceFile();
            let fileName = sourceFile.fileName;
            let pkgInfo = findCurrentProjectInfo(sourceFile.path);
            if (node.kind == ts.SyntaxKind.BinaryExpression) {
                let expr = <ts.BinaryExpression>node;
                if (expr.left.kind == ts.SyntaxKind.PropertyAccessExpression) {
                    let left = <ts.PropertyAccessExpression>expr.left;
                    if (left.expression.kind == ts.SyntaxKind.Identifier && left.expression.getText() == "exports"
                        && left.name.kind == ts.SyntaxKind.Identifier) {
                        let name = left.name;
                        processExportedName(name, node, pkgInfo.name, name.text);

                        //Processing of module.exports happens here
                    } else if (left.expression.kind == ts.SyntaxKind.Identifier && left.name.kind == ts.SyntaxKind.Identifier
                        && left.expression.getText() == "module" && left.name.getText() == "exports") {
                        if (expr.right.kind == ts.SyntaxKind.Identifier) {
                            let name = <ts.Identifier>expr.right;
                            processExportedName(name, node, pkgInfo.name, name.text);

                        } else if (expr.right.kind == ts.SyntaxKind.ObjectLiteralExpression) {
                            let object = <ts.ObjectLiteralExpression>expr.right;
                            if (object.properties) {
                                object.properties.forEach(property => {
                                    if (property.kind == ts.SyntaxKind.PropertyAssignment) {
                                        let prop = <ts.PropertyAssignment>property;
                                        if (prop.name.kind == ts.SyntaxKind.Identifier) {
                                            // let name = prop.initializer && prop.initializer.kind == ts.SyntaxKind.Identifier ? <ts.Identifier>prop.initializer : <ts.Identifier>prop.name;
                                            let name = <ts.Identifier>prop.name;
                                            let text = prop.initializer && prop.initializer.kind == ts.SyntaxKind.Identifier ? (<ts.Identifier>prop.initializer).text : name.text;
                                            processExportedName(name, node, pkgInfo.name, text);
                                        }
                                    }
                                })
                            }
                        } else if (expr.right.kind == ts.SyntaxKind.NewExpression) {
                            let newExpr = <ts.NewExpression>expr.right;
                            if (newExpr.expression.kind == ts.SyntaxKind.Identifier) {
                                let name = <ts.Identifier>newExpr.expression;
                                processExportedName(name, node, pkgInfo.name, name.text);
                            }
                        }
                    }
                }
            } else if (node.kind == ts.SyntaxKind.ExportDeclaration) {
                let decl = <ts.ExportDeclaration>node;
                if (!decl.exportClause) {
                    // TODO: add support of 
                    // "export * from' importedsrc'"
                    return;
                }
                decl.exportClause.elements.forEach(element => {
                    let name = element.name;
                    processExportedName(name, node, pkgInfo.name, name.text);
                });
            }
            if (node.kind == ts.SyntaxKind.FunctionDeclaration) {
                if ((node.flags & ts.NodeFlags.Export) != 0) {
                    let decl = <ts.FunctionDeclaration>node;
                    let text = decl.name.text;
                    let path = parentPath ? `${parentPath}.${text}` : `${pkgInfo.name}.${text}`;
                    let range = Range.create(self.getLineAndPosFromOffset(fileName, decl.name.getStart(sourceFile)), self.getLineAndPosFromOffset(fileName, decl.name.getEnd()));
                    exportedRefs.push({
                        name: text,
                        kind: "function",
                        path: path,
                        location: {
                            file: fileName,
                            range: range
                        },
                        documentation: self.doc(node)
                    });
                }
            } else if (node.kind == ts.SyntaxKind.ClassDeclaration) {
                if (parentPath || (node.flags & ts.NodeFlags.Export) != 0) {
                    let decl = <ts.ClassDeclaration>node;
                    if (!decl.name) {
                        // TODO: add support of "export class {}"
                        return;
                    }
                    let path = `${pkgInfo.name}.${decl.name.text}`;
                    let range = Range.create(self.getLineAndPosFromOffset(fileName, decl.name.getStart(sourceFile)), self.getLineAndPosFromOffset(fileName, decl.name.getEnd()));
                    exportedRefs.push({
                        name: decl.name.text,
                        kind: "class",
                        path: path,
                        location: {
                            file: fileName,
                            range: range
                        },
                        documentation: self.doc(node)
                    });
                    // collecting methods and vars
                    node.getChildren().forEach(child => {
                        collectExports(child, path);
                    })
                }
            } else if (node.kind == ts.SyntaxKind.MethodDeclaration) {
                if (parentPath) {
                    let decl = <ts.MethodDeclaration>node;
                    if (decl.name.kind == ts.SyntaxKind.Identifier) {
                        let name = <ts.Identifier>decl.name;
                        let path = `${parentPath}.${name.text}`;
                        let range = Range.create(self.getLineAndPosFromOffset(fileName, decl.name.getStart(sourceFile)), self.getLineAndPosFromOffset(fileName, decl.name.getEnd()));
                        exportedRefs.push({
                            name: name.text,
                            kind: "method",
                            path: path,
                            location: {
                                file: fileName,
                                range: range
                            },
                            documentation: self.doc(node)
                        });
                    }
                }
            } else if (node.kind == ts.SyntaxKind.VariableDeclaration) {
                if (parentPath || (node.flags & ts.NodeFlags.Export) != 0) {
                    let decl = <ts.VariableDeclaration>node;
                    if (decl.name.kind == ts.SyntaxKind.Identifier) {
                        let name = <ts.Identifier>decl.name;
                        let path = parentPath ? `${parentPath}.${name.text}` : `${pkgInfo.name}.${name.text}`;
                        let range = Range.create(self.getLineAndPosFromOffset(fileName, decl.name.getStart(sourceFile)), self.getLineAndPosFromOffset(fileName, decl.name.getEnd()));
                        exportedRefs.push({
                            name: name.text,
                            kind: "var",
                            path: path,
                            location: {
                                file: fileName,
                                range: range
                            },

                        });
                    }
                }
            } else {
                node.getChildren().forEach(child => {
                    collectExports(child, parentPath);
                })

            }
        }

        for (const sourceFile of this.services.getProgram().getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib && sourceFile.fileName.indexOf("node_modules") == -1) {
                sourceFile.getChildren().forEach(child => {
                    collectExports(child);
                });
            }
        }

        for (const sourceFile of this.services.getProgram().getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib && sourceFile.fileName.indexOf("node_modules") == -1) {
                ts.forEachChild(sourceFile, collectExportedChildDeclaration);
            }
        }

        return exportedRefs;
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
        return this.services.getDefinitionAtPosition(fileName, offset);
    }

    getExternalDefinition(uri: string, line: number, column: number): Location {
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
            return Location.create(util.formExternalUri(externalRes),
                Range.create(this.getLineAndPosFromOffset(fileName, externalRes.start), this.getLineAndPosFromOffset(fileName, externalRes.start + externalRes.len)));
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

    private getLineAndPosFromOffset(fileName: string, offset: number): Position {
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
