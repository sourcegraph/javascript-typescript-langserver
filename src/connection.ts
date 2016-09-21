/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>


import {
    IConnection, createConnection, 
    InitializeParams, InitializeResult,
    TextDocuments,
    TextDocumentPositionParams, Definition, ReferenceParams, Location, Hover, WorkspaceSymbolParams, DidOpenTextDocumentParams, DidCloseTextDocumentParams,
    SymbolInformation, RequestType
} from 'vscode-languageserver';

import * as ts from 'typescript';

import * as util from './util';
import TypeScriptService from './typescript-service';

namespace GlobalRefsRequest {
    export const type: RequestType<WorkspaceSymbolParams, SymbolInformation[], any> = { get method() { return 'textDocument/global-refs'; } };
}

namespace InitializeRequest {
    export const type: RequestType<InitializeParams, InitializeResult, any> = { get method() { return 'initialize'; } };
}

namespace ShutdownRequest {
    export const type = { get method() { return 'shutdown'; } };
}

namespace ExitRequest {
    export const type = { get method() { return 'exit'; } };
}

export default class Connection {

    private connection: IConnection;
    private service: TypeScriptService;

    constructor(input: any, output: any, strict : boolean) {

        this.connection = createConnection(input, output);

        let workspaceRoot : string;

        let documents: TextDocuments = new TextDocuments();

        let closed = false;

        function close() {
            if (!closed) {
                input.close();
                output.close();
                closed = true;
            }
        }

        this.connection.onRequest(InitializeRequest.type, (params: InitializeParams): InitializeResult => {
            console.log('initialize', params.rootPath);
            if (params.rootPath) {
                workspaceRoot = util.uri2path(params.rootPath);
                this.service = new TypeScriptService(workspaceRoot, strict);
                return {
                    capabilities: {
                        // Tell the client that the server works in FULL text document sync mode
                        textDocumentSync: documents.syncKind,
                        hoverProvider: true,
                        definitionProvider: true,
                        referencesProvider: true
                    }
                }
            }
        });

        this.connection.onNotification(ExitRequest.type, function () {
            console.log('exit...');
            close();
        });

        this.connection.onRequest(ShutdownRequest.type, function () {
            console.log('shutdown...');
            return [];
        });

        this.connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
            if (strict) {
                let relpath = util.uri2relpath(params.textDocument.uri, workspaceRoot);
                console.log('add file', workspaceRoot, '/', relpath);
                this.service.addFile(relpath, params.textDocument.text);
            }
        });

        this.connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
            if (strict) {
                let relpath = util.uri2relpath(params.textDocument.uri, workspaceRoot);
                console.log('remove file', workspaceRoot, '/', relpath);
                this.service.removeFile(relpath);
            }
        });

        this.connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
            try {
                console.log('workspace symbols', params.query);
                if (params.query == "exported") {
                    const exported = this.service.getExportedEnts();
                    if (exported) {
                        let res = exported.map(ent => {
                            return SymbolInformation.create(ent.name, ent.kind, ent.location.range,
                                'file:///' + ent.location.file, util.formExternalUri(ent));
                        });
                        console.error("Res = ", res);
                        return res;
                    }
                } else if (params.query == "externals") {
                    const externals = this.service.getExternalRefs();
                    if (externals) {
                        let res = externals.map(external => {
                            return SymbolInformation.create(external.name, util.formEmptyKind(), util.formEmptyRange(), util.formExternalUri(external));
                        });
                        console.error("externals Res = ", res);
                        return res;
                    }
                } else if (params.query == '') {
                    const topDecls = this.service.getTopLevelDeclarations();
                    if (topDecls) {
                        let res = topDecls.map(decl => {
                            return SymbolInformation.create(decl.name, decl.kind, decl.location.range,
                                'file:///' + decl.location.file, util.formExternalUri(decl));
                        });
                        console.error("top declarations = ", res);
                        console.error("Res length = ", res.length);
                        return res;
                    }
                }
                return [];
            } catch (e) {
                console.error(params, e);
                return [];
            }
        });

        this.connection.onDefinition((params: TextDocumentPositionParams): Definition => {
            try {
                console.log('definition', params.textDocument.uri, params.position.line, params.position.character);
                let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                const defs: ts.DefinitionInfo[] = this.service.getDefinition(reluri, params.position.line + 1, params.position.character + 1);
                let result: Location[] = [];
                if (defs) {
                    for (let def of defs) {
                        if (def['url']) {
                            //TODO process external doc ref here
                            //result.push(Location.create(def['url'], util.formEmptyRange()));
                        } else {
                            let start = this.service.position(def.fileName, def.textSpan.start);
                            start.line--;
                            start.character--;
                            let end = this.service.position(def.fileName, def.textSpan.start + def.textSpan.length);
                            end.line--;
                            end.character--;
                            result.push(Location.create(util.path2uri(workspaceRoot, def.fileName), {
                                start: start,
                                end: end
                            }));
                        }
                    }
                } else {
                    //check whether definition is external, if uri string returned, add this location
                    // TODO
                    /*
                     let externalDef = connection.service.getExternalDefinition(params.textDocument.uri, params.position.line, params.position.character);
                     if (externalDef) {
                     let fileName = externalDef.file;
                     let res = Location.create(util.formExternalUri(externalDef), util.formEmptyRange());
                     result.push(res);
                     }
                     */
                }
                return result;
            } catch (e) {
                console.error(params, e);
                return [];
            }
        });

        this.connection.onHover((params: TextDocumentPositionParams): Hover => {
            try {
                console.log('hover', params.textDocument.uri, params.position.line, params.position.character);
                let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                const quickInfo: ts.QuickInfo = this.service.getHover(reluri, params.position.line + 1, params.position.character + 1);
                let contents = [];
                if (quickInfo) {
                    contents.push({language: 'javascript', value: ts.displayPartsToString(quickInfo.displayParts)});
                    let documentation = ts.displayPartsToString(quickInfo.documentation);
                    if (documentation) {
                        contents.push({language: 'text/html', value: documentation});
                    }
                }
                return {contents: contents};
            } catch (e) {
                console.error(params, e);
                return { contents: [] };
            }
        });

        this.connection.onReferences((params: ReferenceParams): Location[] => {
            try {
                // const refs: ts.ReferenceEntry[] = service.getReferences('file:///' + req.body.File, req.body.Line + 1, req.body.Character + 1);
                let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                const refEntries: ts.ReferenceEntry[] = this.service.getReferences(reluri, params.position.line + 1, params.position.character + 1);
                const result: Location[] = [];
                if (refEntries) {
                    for (let ref of refEntries) {
                        let start = this.service.position(ref.fileName, ref.textSpan.start);
                        start.line--;
                        start.character--;
                        let end = this.service.position(ref.fileName, ref.textSpan.start + ref.textSpan.length);
                        end.line--;
                        end.character--;
                        result.push(Location.create(util.path2uri(workspaceRoot, ref.fileName), {
                            start: start,
                            end: end
                        }));

                    }
                }
                return result;
            } catch (e) {
                console.error(params, e);
                return [];
            }
        });

        this.connection.onRequest(GlobalRefsRequest.type, (params: WorkspaceSymbolParams): SymbolInformation[] => {
            try {
                console.log('global-refs', params.query);
                const externals = this.service.getExternalRefs();
                if (externals) {
                    let res = externals.map(external => {
                        return SymbolInformation.create(external.name, util.formEmptyKind(), util.formEmptyRange(), util.formExternalUri(external));
                    });
                    console.error("global refs res = ", res);
                    return res;
                }
                return [];
            } catch (e) {
                console.error(params, e);
                return [];
            }
        });
    }

    start() {
        this.connection.listen();
    }

}
