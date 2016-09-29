/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>
'use strict';

var net = require('net');

import {
    IConnection, createConnection,
    InitializeParams, InitializeResult,
    TextDocuments,
    TextDocumentPositionParams, Definition, ReferenceParams, Location, Hover, WorkspaceSymbolParams, DidOpenTextDocumentParams, DidCloseTextDocumentParams,
    SymbolInformation, RequestType
} from 'vscode-languageserver';

import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, ErrorAction, ErrorHandler, CloseAction, TransportKind } from 'vscode-languageclient';

import * as ts from 'typescript';

import * as util from './util';


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

        // var client = new net.Socket();
        // client.connect(2087, '127.0.0.1', function () {
        //     console.log('Connected to language server');
        // });

        let client: LanguageClient = initLangServerTCP(2088, ["typescript", "typescriptreact", "javascript", "javascriptreact"]);

        function close() {
            if (!closed) {
                input.close();
                output.close();
                closed = true;
            }
        }

        function initLangServerTCP(addr: number, documentSelector: string | string[]): LanguageClient {
            const serverOptions: ServerOptions = function () {
                return new Promise((resolve, reject) => {
                    var client = new net.Socket();
                    client.connect(addr, "127.0.0.1", function () {
                        resolve({
                            reader: client,
                            writer: client
                        });
                    });
                });
            }

            const clientOptions: LanguageClientOptions = {
                documentSelector: documentSelector,
            }

            return new LanguageClient(`tcp lang server (port ${addr})`, serverOptions, clientOptions);
        }

        this.connection.onRequest(InitializeRequest.type, (params: InitializeParams): InitializeResult => {
            console.error('initialize', params.rootPath);
            client.start();
            client.sendRequest(InitializeRequest.type, params);
            return null;
        });

        this.connection.onNotification(ExitRequest.type, function () {
            close();
        });

        this.connection.onRequest(ShutdownRequest.type, function () {
            return [];
        });

        this.connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
        });

        this.connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
        });

        this.connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
            console.error('Build server workspace symbols', params.query);
            return null;
        });

        this.connection.onDefinition((params: TextDocumentPositionParams): Definition => {
            console.error('Build server definition', params.textDocument.uri, params.position.line, params.position.character);
            return null;
        });

        this.connection.onHover((params: TextDocumentPositionParams): Hover => {
            console.error('Build server hover', params.textDocument.uri, params.position.line, params.position.character);
            return null;
        });

        this.connection.onReferences((params: ReferenceParams): Location[] => {
            console.error('Build server references', params.textDocument.uri, params.position.line, params.position.character);
            return null;
        });

        this.connection.onRequest(GlobalRefsRequest.type, (params: WorkspaceSymbolParams): SymbolInformation[] => {
            console.error('Build server global-refs', params.query);
            return null;
        });
    }

    start() {
        this.connection.listen();
    }

}
