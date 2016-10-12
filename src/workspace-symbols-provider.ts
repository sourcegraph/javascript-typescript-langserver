/// <reference path="../typings/node/node.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as packages from './find-packages';
import * as util from './util';
import { Position, Range, Location } from 'vscode-languageserver';

import TypeScriptService from './typescript-service';

export default class WorkspaceSymbolsProvider {
    service: TypeScriptService;

    constructor(service: TypeScriptService) {
        this.service = service;
    }

    collectTopLevelInterface(limit?: number) {
        let start = new Date().getTime();
        let decls = [];
        let topDecls = [];
        let self = this;
        let count = 0;
        for (const sourceFile of this.service.services.getProgram().getSourceFiles()) {
            if (!sourceFile.hasNoDefaultLib && sourceFile.fileName.indexOf("node_modules") == -1 && (!limit || count < limit)) {
                sourceFile.getChildren().forEach(child => {
                    if (!limit || count < limit) {
                        collectTopLevelDeclarations(child, true);
                    }
                });
            }
        }

        // for (const sourceFile of this.service.services.getProgram().getSourceFiles()) {
        //     if (!sourceFile.hasNoDefaultLib && sourceFile.fileName.indexOf("node_modules") == -1) {
        //         ts.forEachChild(sourceFile, collectTopLevelChildDeclaration);
        //     }
        // }

        let end = new Date().getTime();
        console.error("Time in milliseconds = ", end - start);
        return limit ? decls.slice(0, limit) : decls;


        function processNamedDeclaration(node: ts.Node, analyzeChildren, parentPath?: string) {
            if (util.isNamedDeclaration(node)) {
                let sourceFile = node.getSourceFile();
                let fileName = sourceFile.fileName;
                let decl = <ts.Declaration>node;
                let name = <ts.Identifier>decl.name;
                let range = Range.create(self.service.getPositionFromOffset(fileName, name.getStart(sourceFile)), self.service.getPositionFromOffset(fileName, name.getEnd()));
                let path = parentPath ? `${parentPath}.${name.text}` : name.text;
                topDecls.push({ name: name.text, path: path });
                count = count + 1;
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

        function collectTopLevelChildDeclaration(node: ts.Node) {
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
                                let res = topDecls.find(elem => {
                                    if (elem.name == parentExpr.expression['text']) {
                                        return true;
                                    }
                                });

                                if (res) {
                                    let name = parent.name;
                                    let range = Range.create(self.service.getPositionFromOffset(fileName, name.getStart(sourceFile)), self.service.getPositionFromOffset(fileName, name.getEnd()));
                                    decls.push({
                                        name: name.text,
                                        kind: "property",
                                        path: `${res.path}.${name.text}`,
                                        location: {
                                            file: fileName,
                                            range: range
                                        },
                                    });
                                }
                            }
                        }
                    }
                }
            }
            ts.forEachChild(node, collectTopLevelChildDeclaration);
        }

        function collectTopLevelDeclarations(node: ts.Node, analyzeChildren, parentPath?: string) {
            //console.error("Inside collect top level decl with parentPath = ", parentPath, " in file = ", node.getSourceFile().fileName);
            if (!limit || count < limit) {
                let sourceFile = node.getSourceFile();
                let fileName = sourceFile.fileName;
                if (node.kind == ts.SyntaxKind.SyntaxList) {
                    node.getChildren().forEach(child => {
                        if (!limit || count < limit) {
                            collectTopLevelDeclarations(child, true);
                        }
                    });
                } else if (node.kind == ts.SyntaxKind.VariableStatement) {
                    let stmt = <ts.VariableStatement>node;
                    if (stmt.declarationList) {
                        let varDecls = stmt.declarationList.declarations;
                        if (varDecls) {
                            varDecls.forEach(varDecl => {
                                if (!limit || count < limit) {
                                    processNamedDeclaration(varDecl, analyzeChildren, parentPath);
                                }
                            });
                        }
                    }
                } else {
                    processNamedDeclaration(node, analyzeChildren, parentPath);
                }
            }
        }
    }
}
