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
                        collectTopLevelDeclarations(child, sourceFile, true);
                    }
                });
            }
        }

        let end = new Date().getTime();
        console.error("Time in milliseconds = ", end - start);
        return limit ? decls.slice(0, limit) : decls;


        function processNamedDeclaration(node: ts.Node, sourceFile: SourceFile, analyzeChildren, parentPath?: string) {
            if (util.isNamedDeclaration(node)) {
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
                        collectTopLevelDeclarations(child, sourceFile, false, path);
                    });
                }
            }
        }

        function collectTopLevelDeclarations(node: ts.Node, sourceFile: SourceFile, analyzeChildren, parentPath?: string) {
            if (!limit || count < limit) {
                let fileName = sourceFile.fileName;
                if (node.kind == ts.SyntaxKind.SyntaxList) {
                    node.getChildren().forEach(child => {
                        if (!limit || count < limit) {
                            collectTopLevelDeclarations(child, sourceFile, true);
                        }
                    });
                } else if (node.kind == ts.SyntaxKind.VariableStatement) {
                    let stmt = <ts.VariableStatement>node;
                    if (stmt.declarationList) {
                        let varDecls = stmt.declarationList.declarations;
                        if (varDecls) {
                            varDecls.forEach(varDecl => {
                                if (!limit || count < limit) {
                                    processNamedDeclaration(varDecl, sourceFile, analyzeChildren, parentPath);
                                }
                            });
                        }
                    }
                } else {
                    processNamedDeclaration(node, sourceFile, analyzeChildren, parentPath);
                }
            }
        }
    }
}
