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
    SymbolInformation,
    RequestType,
    Range
} from 'vscode-languageserver';

import * as ts from 'typescript';

import * as util from './util';
import TypeScriptService from './typescript-service';

import * as rt from './request-type';

export default class Connection {

    connection: IConnection;

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

        function initialize(): Thenable<void> {
            if (!initialized) {
                initialized = service.projectManager.initialize();
            }
            return initialized;
        }


        this.connection.onRequest(rt.InitializeRequest.type, (params: InitializeParams): Promise<InitializeResult> => {
            console.error('initialize', params.rootPath);
            return new Promise<InitializeResult>(function (resolve) {
                if (params.rootPath) {
                    workspaceRoot = util.uri2path(params.rootPath);
                    service = new TypeScriptService(workspaceRoot, strict, self.connection);
                    resolve({
                        capabilities: {
                            // Tell the client that the server works in FULL text document sync mode
                            textDocumentSync: documents.syncKind,
                            hoverProvider: true,
                            definitionProvider: true,
                            referencesProvider: true,
                            workspaceSymbolProvider: true
                        }
                    })
                }
            });
        });

        this.connection.onNotification(rt.ExitRequest.type, function () {
            close();
        });

        this.connection.onRequest(rt.ShutdownRequest.type, function () {
            return [];
        });


        this.connection.onRequest(rt.WorkspaceSymbolsRequest.type, (params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]> => {
            const enter = new Date().getTime();
            return new Promise<SymbolInformation[]>(function (resolve, reject) {
                initialize().then(function () {
                    let result = [];
                    const init = new Date().getTime();
                    try {
                        // TODO: optimize and restore exported and externals processing
                        /*if (params.query == "exported") {
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
                        } else */ {
                            return service.getWorkspaceSymbols(params.query, params.limit).then((result) => {
                                const exit = new Date().getTime();
                                console.error('symbol', params.query, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
                                return resolve(result);
                            });
                        }
                    } catch (e) {
                        console.error(params, e);
                        return resolve([]);
                    }
                }, function (err) {
                    initialized = null;
                    return reject(err)
                })
            });
        });

        this.connection.onDefinition((params: TextDocumentPositionParams): Promise<Definition> => {
            const enter = new Date().getTime();
            return new Promise<Definition>(function (resolve, reject) {
                initialize().then(function () {
                    try {
                        const init = new Date().getTime();
                        let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                        service.getDefinition(reluri, params.position.line, params.position.character).then(function (result) {
                            const exit = new Date().getTime();
                            console.error('definition', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
                            return resolve(result);
                        }, function (e) {
                            return reject(e);
                        });
                    } catch (e) {
                        console.error(params, e);
                        return resolve([]);
                    }
                }, function (err) {
                    initialized = null;
                    return reject(err)
                });
            });
        });

        this.connection.onHover((params: TextDocumentPositionParams): Promise<Hover> => {
            const enter = new Date().getTime();
            return new Promise<Hover>(function (resolve, reject) {
                initialize().then(function () {
                    const init = new Date().getTime();
                    try {
                        let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                        service.getHover(reluri, params.position.line, params.position.character).then(function (quickInfo) {
                            let contents = [];
                            if (quickInfo) {
                                contents.push({
                                    language: 'typescript',
                                    value: ts.displayPartsToString(quickInfo.displayParts)
                                });
                                let documentation = ts.displayPartsToString(quickInfo.documentation);
                                if (documentation) {
                                    contents.push(documentation);
                                }
                            }
                            const exit = new Date().getTime();
                            console.error('hover', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
                            resolve({ contents: contents });
                        }, function (e) {
                            return reject(e);
                        });
                    } catch (e) {
                        console.error(params, e);
                        resolve({ contents: [] });
                    }
                }, function (err) {
                    initialized = null;
                    return reject(err)
                })
            });
        });

        this.connection.onReferences((params: ReferenceParams): Promise<Location[]> => {
            return new Promise<Location[]>(function (resolve, reject) {
                const enter = new Date().getTime();
                initialize().then(function () {
                    const init = new Date().getTime();
                    try {
                        let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
                        service.getReferences(reluri, params.position.line, params.position.character).then(
                            function (result) {
                                const exit = new Date().getTime();
                                console.error('references', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
                                return resolve(result);
                            }
                        );
                    } catch (e) {
                        console.error(params, e);
                        return resolve([]);
                    }
                }, function (err) {
                    initialized = null;
                    return reject(err)
                })
            });
        });

        this.connection.onRequest(rt.GlobalRefsRequest.type, (params: WorkspaceSymbolParams): Promise<SymbolInformation[]> => {
            return new Promise<SymbolInformation[]>(function (resolve, reject) {
                initialize().then(function () {

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
                }, function (err) {
                    initialized = null;
                    return reject(err)
                })
            });
        });
    }

    start() {
        this.connection.listen();
    }

    sendRequest<P, R, E>(type: RequestType<P, R, E>, params?: P): Thenable<R> {
        return this.connection.sendRequest(type, params);
    }

}
