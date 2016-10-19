/// <reference path="../typings/node/node.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as packages from './find-packages';
import * as util from './util';
import { Position, Range, Location } from 'vscode-languageserver';

import TypeScriptService from './typescript-service';

export default class ExportedSymbolsProvider {
    service: TypeScriptService;

    constructor(service: TypeScriptService) {
        this.service = service;
    }

    collectExportedEntities() {
        let exportedRefs = [];
        let self = this;
        let allExports = [];
        let pkgMap = null;

        function findCurrentProjectInfo(fileName) {
            // (alexsaveliev) TypeScript returns lowercase path items
            if (pkgMap === null) {
                const packageDefs = packages.collectFiles(self.service.root, ["node_modules"]);
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
            let type = self.service.projectManager.getConfiguration(fileName).service.getTypeDefinitionAtPosition(fileName, posInFile);
            let kind = "";
            if (type && type.length > 0) {
                kind = type[0].kind;
            }

            let path = `${pathInfo}.${name.text}`;

            let range = Range.create(self.service.getPositionFromOffset(fileName, posInFile), self.service.getPositionFromOffset(fileName, name.getEnd()));
            allExports.push({ name: text || name.text, path: path });
            exportedRefs.push({
                name: name.text,
                kind: kind,
                path: path,
                location: {
                    file: fileName,
                    range: range
                },
                documentation: self.service.doc(node)
            });
        }

        function collectExportedChildDeclaration(node: ts.Node) {
            let sourceFile = node.getSourceFile();
            let fileName = sourceFile.fileName;
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
                if ((node.flags & ts.ModifierFlags.Export) != 0) {
                    let decl = <ts.FunctionDeclaration>node;
                    let text = decl.name.text;
                    let path = parentPath ? `${parentPath}.${text}` : `${pkgInfo.name}.${text}`;
                    let range = Range.create(self.service.getPositionFromOffset(fileName, decl.name.getStart(sourceFile)), self.service.getPositionFromOffset(fileName, decl.name.getEnd()));
                    exportedRefs.push({
                        name: text,
                        kind: "function",
                        path: path,
                        location: {
                            file: fileName,
                            range: range
                        },
                        documentation: self.service.doc(node)
                    });
                }
            } else if (node.kind == ts.SyntaxKind.ClassDeclaration) {
                if (parentPath || (node.flags & ts.ModifierFlags.Export) != 0) {
                    let decl = <ts.ClassDeclaration>node;
                    if (!decl.name) {
                        // TODO: add support of "export class {}"
                        return;
                    }
                    let path = `${pkgInfo.name}.${decl.name.text}`;
                    let range = Range.create(self.service.getPositionFromOffset(fileName, decl.name.getStart(sourceFile)), self.service.getPositionFromOffset(fileName, decl.name.getEnd()));
                    exportedRefs.push({
                        name: decl.name.text,
                        kind: "class",
                        path: path,
                        location: {
                            file: fileName,
                            range: range
                        },
                        documentation: self.service.doc(node)
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
                        let range = Range.create(self.service.getPositionFromOffset(fileName, decl.name.getStart(sourceFile)), self.service.getPositionFromOffset(fileName, decl.name.getEnd()));
                        exportedRefs.push({
                            name: name.text,
                            kind: "method",
                            path: path,
                            location: {
                                file: fileName,
                                range: range
                            },
                            documentation: self.service.doc(node)
                        });
                    }
                }
            } else if (node.kind == ts.SyntaxKind.VariableDeclaration) {
                if (parentPath || (node.flags & ts.ModifierFlags.Export) != 0) {
                    let decl = <ts.VariableDeclaration>node;
                    if (decl.name.kind == ts.SyntaxKind.Identifier) {
                        let name = <ts.Identifier>decl.name;
                        let path = parentPath ? `${parentPath}.${name.text}` : `${pkgInfo.name}.${name.text}`;
                        let range = Range.create(self.service.getPositionFromOffset(fileName, decl.name.getStart(sourceFile)), self.service.getPositionFromOffset(fileName, decl.name.getEnd()));
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

        const configuration = this.service.projectManager.getAnyConfiguration();

        // TODO: multiple projects support
        for (const sourceFile of configuration.program.getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib && sourceFile.fileName.indexOf("node_modules") == -1) {
                sourceFile.getChildren().forEach(child => {
                    collectExports(child);
                });
            }
        }

        // TODO: multiple projects support
        for (const sourceFile of configuration.program.getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib && sourceFile.fileName.indexOf("node_modules") == -1) {
                ts.forEachChild(sourceFile, collectExportedChildDeclaration);
            }
        }

        return exportedRefs;
    }

}
