/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>


import {
    IConnection,
    createConnection,
    InitializeParams,
    InitializeResult,
    TextDocuments,
    TextDocumentPositionParams,
    Definition,
    ReferenceParams,
    Location,
    Hover,
    WorkspaceSymbolParams,
    DidOpenTextDocumentParams,
    DidCloseTextDocumentParams,
    SymbolInformation,
    RequestType,
    SymbolKind, Range
} from 'vscode-languageserver';

import * as ts from 'typescript';

import * as util from './util';
import TypeScriptService from './typescript-service';

interface WorkspaceSymbolParamsWithLimit {
    query: string;
    limit: number;
}

namespace WorkspaceSymbolsRequest {
    export const type: RequestType<WorkspaceSymbolParamsWithLimit, SymbolInformation[], any> = {
        get method() {
            return 'workspace/symbol';
        }
    };
}



namespace GlobalRefsRequest {
    export const type: RequestType<WorkspaceSymbolParams, SymbolInformation[], any> = {
        get method() {
            return 'textDocument/global-refs';
        }
    };
}



namespace InitializeRequest {
    export const type: RequestType<InitializeParams, InitializeResult, any> = {
        get method() {
            return 'initialize';
        }
    };
}

namespace ShutdownRequest {
    export const type = {
        get method() {
            return 'shutdown';
        }
    };
}

namespace ExitRequest {
    export const type = {
        get method() {
            return 'exit';
        }
    };
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

        let self = this;

        let initialized: Thenable<void> = null;

        this.connection.onRequest(InitializeRequest.type, (params: InitializeParams): Promise<InitializeResult> => {
            console.error('initialize', params.rootPath);
            return new Promise<InitializeResult>(function (resolve) {
                if (params.rootPath) {
                    workspaceRoot = util.uri2path(params.rootPath);
                    service = new TypeScriptService(workspaceRoot, strict, self.connection);
                    initialized = service.host.initialize(workspaceRoot);
                    resolve({
                        capabilities: {
                            // Tell the client that the server works in FULL text document sync mode
                            textDocumentSync: documents.syncKind,
                            hoverProvider: true,
                            definitionProvider: true,
                            referencesProvider: true
                        }
                    })
                }
            });
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

        this.connection.onRequest(WorkspaceSymbolsRequest.type, (params: WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]> => {
            const enter = new Date().getTime();
            return new Promise<SymbolInformation[]>(function (resolve, reject) {
                initialized.then(function () {
                    let result = [];
                    const init = new Date().getTime();
                    try {
                        if (params.query == "exported") {
                            const exported = service.getExportedEnts();
                            if (exported) {
                                result = exported.map(ent => {
                                    return SymbolInformation.create(ent.name, ent.kind, ent.location.range,
                                        'file:///' + ent.location.file, util.formExternalUri(ent));
                                });
                            }
                        } else if (params.query == "externals") {
                            const externals = service.getExternalRefs();
                            if (externals) {
                                result = externals.map(external => {
                                    return SymbolInformation.create(external.name, util.formEmptyKind(), util.formEmptyRange(), util.formExternalUri(external));
                                });
                            }
                        } else if (params.query == '') {
                            const topDecls = service.getTopLevelDeclarations(params.limit);
                            if (topDecls) {
                                result = topDecls.map(decl => {
                                    return SymbolInformation.create(decl.name, decl.kind, decl.location.range,
                                        'file:///' + decl.location.file, util.formExternalUri(decl));
                                });
                            }
                        } else {
                            const navigateToItems = service.getWorkspaceSymbols(params.query, params.limit);
                            if (navigateToItems) {
                                result = navigateToItems.map(item => {
                                    let start = ts.getLineAndCharacterOfPosition(service.services.getProgram().getSourceFile(item.fileName), item.textSpan.start);
                                    let end = ts.getLineAndCharacterOfPosition(service.services.getProgram().getSourceFile(item.fileName), item.textSpan.start + item.textSpan.length);
                                    return SymbolInformation.create(item.name, util.convertStringtoSymbolKind(item.kind), Range.create(start.line, start.character, end.line, end.character), 'file:///' + item.fileName, item.containerName);
                                });
                            }
                        }
                        const exit = new Date().getTime();
                        console.error('symbol', params.query, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
                        return resolve(result);
                    } catch (e) {
                        console.error(params, e);
                        return resolve([]);
                    }
                }, function () {
                    return reject()
                })
            });
        });

        this.connection.onDefinition((params: TextDocumentPositionParams): Promise<Definition> => {
            const enter = new Date().getTime();
            return new Promise<Definition>(function (resolve, reject) {
                initialized.then(function () {
                    try {
                        const init = new Date().getTime();
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
                        const exit = new Date().getTime();
                        console.error('definition', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
                        return resolve(result);
                    } catch (e) {
                        console.error(params, e);
                        return resolve([]);
                    }
                }, function () {
                    return reject()
                });
            });
        });

        this.connection.onHover((params: TextDocumentPositionParams): Promise<Hover> => {
            const enter = new Date().getTime();
            return new Promise<Hover>(function (resolve, reject) {
                initialized.then(function () {
                    const init = new Date().getTime();
                    try {
                        let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                        const quickInfo: ts.QuickInfo = service.getHover(reluri, params.position.line, params.position.character);
                        let contents = [];
                        if (quickInfo) {
                            contents.push({
                                language: 'javascript',
                                value: ts.displayPartsToString(quickInfo.displayParts)
                            });
                            let documentation = ts.displayPartsToString(quickInfo.documentation);
                            if (documentation) {
                                contents.push({ language: 'text/html', value: documentation });
                            }
                        }
                        const exit = new Date().getTime();
                        console.error('hover', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
                        resolve({ contents: contents });
                    } catch (e) {
                        console.error(params, e);
                        resolve({ contents: [] });
                    }
                }, function () {
                    return reject()
                })
            });
        });

        this.connection.onReferences((params: ReferenceParams): Promise<Location[]> => {
            return new Promise<Location[]>(function (resolve, reject) {
                const enter = new Date().getTime();
                initialized.then(function () {
                    const init = new Date().getTime();
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
                        const exit = new Date().getTime();
                        console.error('references', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
                        return resolve(result);
                    } catch (e) {
                        console.error(params, e);
                        return resolve([]);
                    }
                }, function () {
                    return reject()
                })
            });
        });

        this.connection.onRequest(GlobalRefsRequest.type, (params: WorkspaceSymbolParams): Promise<SymbolInformation[]> => {
            return new Promise<SymbolInformation[]>(function (resolve, reject) {
                initialized.then(function () {

                    try {
                        console.error('global-refs', params.query);
                        const externals = service.getExternalRefs();
                        if (externals) {
                            let res = externals.map(external => {
                                return SymbolInformation.create(external.name, util.formEmptyKind(), util.formEmptyRange(), util.formExternalUri(external));
                            });
                            return resolve(res);
                        }
                        return resolve([]);
                    } catch (e) {
                        console.error(params, e);
                        return resolve([]);
                    }
                }, function () {
                    return reject()
                })
            });
        });
    }

    start() {
        this.connection.listen();
    }

}
