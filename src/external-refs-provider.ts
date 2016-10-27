import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as packages from './find-packages';
import * as util from './util';
import { Position, Range, Location } from 'vscode-languageserver';

import TypeScriptService from './typescript-service';

export default class ExternalRefsProvider {
    service: TypeScriptService;

    constructor(service: TypeScriptService) {
        this.service = service;
    }

    collectExternalLibs() {
        let pkgFiles = packages.collectFiles(this.service.root + "/node_modules", ["node_modules"]);
        let pkgsInfo = pkgFiles.map(pkg => {
            return { name: pkg.package.name, repo: pkg.package.repository && pkg.package.repository.url, version: pkg.package._shasum }
        });
        return pkgsInfo;
    };

    collectExternals() {
        let importRefs = [];
        let externalLibs = this.collectExternalLibs();

        // TODO: multiple projects

        for (const sourceFile of this.service.projectManager.getAnyConfiguration().program.getSourceFiles()) {
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
                            let refs: ts.ReferenceEntry[] = this.service.projectManager.getConfiguration(sourceFile.fileName).service.getReferencesAtPosition(sourceFile.fileName, posInFile);
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
                                let refs: ts.ReferenceEntry[] = this.service.projectManager.getConfiguration(sourceFile.fileName).service.getReferencesAtPosition(sourceFile.fileName, posInFile);
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
                                let refs: ts.ReferenceEntry[] = this.service.projectManager.getConfiguration(sourceFile.fileName).service.getReferencesAtPosition(sourceFile.fileName, posInFile);
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
                                let refs: ts.ReferenceEntry[] = this.service.projectManager.getConfiguration(sourceFile.fileName).service.getReferencesAtPosition(sourceFile.fileName, posInFile);
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
				let collectIds = (node: ts.Node): void => {
                    if (node.kind == ts.SyntaxKind.Identifier) {
                        ids.push(node);
                    }
                    ts.forEachChild(node, collectIds);
                }
                ts.forEachChild(node, collectIds);

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



}
