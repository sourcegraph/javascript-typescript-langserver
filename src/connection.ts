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

    constructor(input: any, output: any, strict: boolean) {

        this.connection = createConnection(input, output);

        input.removeAllListeners('end');
        input.removeAllListeners('close');
        output.removeAllListeners('end');
        output.removeAllListeners('close');

        let workspaceRoot: string;

        let documents: TextDocuments = new TextDocuments();

        let closed = false;

        function close() {
            if (!closed) {
                input.close();
                output.close();
                closed = true;
            }
        }

        let service: TypeScriptService;

        this.connection.onRequest(InitializeRequest.type, (params: InitializeParams): InitializeResult => {
            console.error('initialize', params.rootPath);
            if (params.rootPath) {
                workspaceRoot = util.uri2path(params.rootPath);
                service = new TypeScriptService(workspaceRoot, strict);
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
            close();
        });

        this.connection.onRequest(ShutdownRequest.type, function () {
            return [];
        });

        this.connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
            let relpath = util.uri2relpath(params.textDocument.uri, workspaceRoot);
            console.error('add file', workspaceRoot, '/', relpath);
            service.addFile(relpath, params.textDocument.text);
        });

        this.connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
            let relpath = util.uri2relpath(params.textDocument.uri, workspaceRoot);
            console.error('remove file', workspaceRoot, '/', relpath);
            service.removeFile(relpath);
        });

        this.connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
            try {
                console.error('workspace symbols', params.query);
                if (params.query == "exported") {
                    const exported = service.getExportedEnts();
                    if (exported) {
                        let res = exported.map(ent => {
                            return SymbolInformation.create(ent.name, ent.kind, ent.location.range,
                                'file:///' + ent.location.file, util.formExternalUri(ent));
                        });
                        console.error("Res = ", res);
                        return res;
                    }
                } else if (params.query == "externals") {
                    const externals = service.getExternalRefs();
                    if (externals) {
                        let res = externals.map(external => {
                            return SymbolInformation.create(external.name, util.formEmptyKind(), util.formEmptyRange(), util.formExternalUri(external));
                        });
                        console.error("externals Res = ", res);
                        return res;
                    }
                } else if (params.query == '') {
                    const topDecls = service.getTopLevelDeclarations();
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
                console.error('definition', params.textDocument.uri, params.position.line, params.position.character);
                let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                const defs: ts.DefinitionInfo[] = service.getDefinition(reluri, params.position.line, params.position.character);
                let result: Location[] = [];
                if (defs) {
                    for (let def of defs) {
                        // if (def['url']) {
                        //TODO process external doc ref here
                        //result.push(Location.create(def['url'], util.formEmptyRange()));
                        // } else {
                        let start = ts.getLineAndCharacterOfPosition(service.services.getProgram().getSourceFile(def.fileName), def.textSpan.start);
                        let end = ts.getLineAndCharacterOfPosition(service.services.getProgram().getSourceFile(def.fileName), def.textSpan.start + def.textSpan.length);
                        result.push(Location.create(util.path2uri(workspaceRoot, def.fileName), {
                            start: start,
                            end: end
                        }));
                        // }
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
                console.error('hover', params.textDocument.uri, params.position.line, params.position.character);
                let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                const quickInfo: ts.QuickInfo = service.getHover(reluri, params.position.line, params.position.character);
                let contents = [];
                if (quickInfo) {
                    contents.push({ language: 'javascript', value: ts.displayPartsToString(quickInfo.displayParts) });
                    let documentation = ts.displayPartsToString(quickInfo.documentation);
                    if (documentation) {
                        contents.push({ language: 'text/html', value: documentation });
                    }
                }
                return { contents: contents };
            } catch (e) {
                console.error(params, e);
                return { contents: [] };
            }
        });

        this.connection.onReferences((params: ReferenceParams): Location[] => {
            try {
                // const refs: ts.ReferenceEntry[] = service.getReferences('file:///' + req.body.File, req.body.Line + 1, req.body.Character + 1);
                let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                const refEntries: ts.ReferenceEntry[] = service.getReferences(reluri, params.position.line, params.position.character);
                const result: Location[] = [];
                if (refEntries) {
                    for (let ref of refEntries) {
                        let start = ts.getLineAndCharacterOfPosition(service.services.getProgram().getSourceFile(ref.fileName), ref.textSpan.start);
                        let end = ts.getLineAndCharacterOfPosition(service.services.getProgram().getSourceFile(ref.fileName), ref.textSpan.start + ref.textSpan.length);
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
                console.error('global-refs', params.query);
                const externals = service.getExternalRefs();
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
