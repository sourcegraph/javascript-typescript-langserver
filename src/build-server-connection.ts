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


        function close() {
            if (!closed) {
                input.close();
                output.close();
                closed = true;
            }
        }

        this.connection.onRequest(InitializeRequest.type, (params: InitializeParams): InitializeResult => {
            console.error('Build server initialize', params.rootPath);

            var client = new net.Socket();

            //just for testing purposes now, check that build server calls langserver - but it works
            client.connect(2089, '127.0.0.1', function () {
                console.log('Connected to language server');
                client.write('Content-Length: 145\r\n');
                client.write('Content-Type: application/vscode-jsonrpc; charset=utf8\r\n\r\n');
                client.write('{"id":"1","jsonrpc":"2.0","method":"initialize","params":{"processId":0,"rootPath":"/Users/tonya/ts-server/poc-jslang-server","capabilities":{}}}');
            });

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
