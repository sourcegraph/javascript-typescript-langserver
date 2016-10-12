/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { IConnection, Position } from 'vscode-languageserver';

import * as util from './util';
import VersionedLanguageServiceHost from './language-service-host';

import ExportedSymbolsProvider from './exported-symbols-provider'
import ExternalRefsProvider from './external-refs-provider';
import WorkspaceSymbolsProvider from './workspace-symbols-provider';
import * as FileSystem from './fs';

var sanitizeHtml = require('sanitize-html');
var JSONPath = require('jsonpath-plus');

const pathDelimiter = "$";

export default class TypeScriptService {
    services: ts.LanguageService;
    root: string;
    externalRefs = null;
    exportedEnts = null;
    topLevelDecls = null;
    exportedSymbolProvider: ExportedSymbolsProvider;
    externalRefsProvider: ExternalRefsProvider;
    workspaceSymbolProvider: WorkspaceSymbolsProvider;

    host: VersionedLanguageServiceHost;

    envDefs = [];

    constructor(root: string, strict: boolean, connection: IConnection) {
        this.root = root;
        this.host = new VersionedLanguageServiceHost(root, strict, connection);

        // Create the language service files
        this.services = ts.createLanguageService(this.host, ts.createDocumentRegistry());
        this.initEnvDefFiles();

        //initialize providers 
        this.exportedSymbolProvider = new ExportedSymbolsProvider(this);
        this.externalRefsProvider = new ExternalRefsProvider(this);
        this.workspaceSymbolProvider = new WorkspaceSymbolsProvider(this);
    }

    addFile(name, content: string) {
        this.host.addFile(name, content);
    }

    removeFile(name: string) {
        this.host.removeFile(name);
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
        try {
            const fileName: string = util.uri2path(uri);
            if (!this.host.hasFile(fileName)) {
                return [];
            }

            const offset: number = ts.getPositionOfLineAndCharacter(this.services.getProgram().getSourceFile(fileName), line, column);
            return this.services.getDefinitionAtPosition(fileName, offset);
            // if (defs) {
            //     defs.forEach(def => {
            //         let fileName = def.fileName;
            //         let name = def.name;
            //         let container = def.containerName.toLowerCase();
            //         if (fileName.indexOf("merged.lib.d.ts") > -1) {
            //             let result = this.lookupEnvDef(name, container);
            //             if (result) {
            //                 def['url'] = result['!url'];
            //             }
            //         }
            //     });
            // }
            // return defs;
        } catch (exc) {
            console.error("Exception occurred = ", exc);
        }
    }

    getExternalDefinition(uri: string, line: number, column: number) {
        const fileName: string = util.uri2path(uri);
        if (!this.host.hasFile(fileName)) {
            return;
        }

        const offset: number = ts.getPositionOfLineAndCharacter(this.services.getProgram().getSourceFile(fileName), line, column);
        return this.getExternalRefs().find(ref => {
            if (ref.file == fileName && ref.pos == offset) {
                return true;
            }
        });
    }

    getTopLevelDeclarations(limit?:number) { 
        if (this.topLevelDecls === null) {
            this.topLevelDecls = this.workspaceSymbolProvider.collectTopLevelInterface(limit);
        }

        return this.topLevelDecls;
    }


    getHover(uri: string, line: number, column: number): ts.QuickInfo {
        try {
            const fileName: string = util.uri2path(uri);
            if (!this.host.hasFile(fileName)) {
                return null;
            }

            const offset: number = ts.getPositionOfLineAndCharacter(this.services.getProgram().getSourceFile(fileName), line, column);
            return this.services.getQuickInfoAtPosition(fileName, offset);
        } catch (exc) {
            console.error("Exception occcurred = ", exc);
        }
    }

    getReferences(uri: string, line: number, column: number): ts.ReferenceEntry[] {
        try {
            const fileName: string = util.uri2path(uri);
            if (!this.host.hasFile(fileName)) {
                return null;
            }

            const offset: number = ts.getPositionOfLineAndCharacter(this.services.getProgram().getSourceFile(fileName), line, column);
            // const offset: number = this.offset(fileName, line, column);
            return this.services.getReferencesAtPosition(fileName, offset);
        } catch (exc) {
            console.error("Exception occcurred = ", exc);
        }
    }

    getWorkspaceSymbols(query: string, limit?: number): ts.NavigateToItem[] {
        let items: ts.NavigateToItem[] = this.services.getNavigateToItems(query, limit);
        return items;
    }

    getPositionFromOffset(fileName: string, offset: number): Position {
        let res = ts.getLineAndCharacterOfPosition(this.services.getProgram().getSourceFile(fileName), offset);
        return Position.create(res.line, res.character);
    }


    private resolvePath(p: string): string {
        return path.resolve(this.root, p);
    }
}
