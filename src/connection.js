"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const vscode_languageserver_1 = require("vscode-languageserver");
const util = require("./util");
const fs = require("./fs");
const rt = require("./request-type");
function newConnection(input, output) {
    const connection = vscode_languageserver_1.createConnection(input, output);
    input.removeAllListeners('end');
    input.removeAllListeners('close');
    output.removeAllListeners('end');
    output.removeAllListeners('close');
    let closed = false;
    function close() {
        if (!closed) {
            input.close();
            output.close();
            closed = true;
        }
    }
    // We attach one notification handler on `exit` here to handle the
    // teardown of the connection.  If other handlers want to do
    // something on connection destruction, they should register a
    // handler on `shutdown`.
    connection.onNotification(rt.ExitRequest.type, close);
    return connection;
}
exports.newConnection = newConnection;
function registerLanguageHandler(connection, strict, handler) {
    connection.onRequest(rt.InitializeRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        console.error('initialize', params.rootPath);
        let remoteFs;
        if (strict) {
            remoteFs = new fs.RemoteFileSystem(connection);
        }
        else {
            remoteFs = new fs.LocalFileSystem(util.uri2path(params.rootPath));
        }
        try {
            return yield handler.initialize(params, remoteFs, strict);
        }
        catch (e) {
            console.error(params, e);
            return Promise.reject(e);
        }
    }));
    connection.onShutdown(() => handler.shutdown());
    connection.onDidOpenTextDocument((params) => handler.didOpen(params));
    connection.onDidChangeTextDocument((params) => handler.didChange(params));
    connection.onDidSaveTextDocument((params) => handler.didSave(params));
    connection.onDidCloseTextDocument((params) => handler.didClose(params));
    connection.onRequest(rt.WorkspaceSymbolsRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        const enter = new Date().getTime();
        try {
            const result = yield handler.getWorkspaceSymbols(params);
            const exit = new Date().getTime();
            console.error('workspace/symbol', params.query, 'total', (exit - enter) / 1000.0, 'busy', (exit - enter) / 1000.0);
            return Promise.resolve(result || []);
        }
        catch (e) {
            console.error(params, e);
            return Promise.reject(e);
        }
    }));
    connection.onRequest(rt.DocumentSymbolRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        const enter = new Date().getTime();
        try {
            const result = yield handler.getDocumentSymbol(params);
            const exit = new Date().getTime();
            console.error('textDocument/documentSymbol', 'total', (exit - enter) / 1000.0, 'busy', (exit - enter) / 1000.0);
            return Promise.resolve(result || []);
        }
        catch (e) {
            console.error(params, e);
            return Promise.reject(e);
        }
    }));
    connection.onRequest(rt.WorkspaceReferenceRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        const enter = new Date().getTime();
        try {
            const result = yield handler.getWorkspaceReference(params);
            const exit = new Date().getTime();
            console.error('workspace/reference', 'total', (exit - enter) / 1000.0, 'busy', (exit - enter) / 1000.0);
            return Promise.resolve(result || []);
        }
        catch (e) {
            console.error(params, e);
            return Promise.reject(e);
        }
    }));
    connection.onDefinition((params) => __awaiter(this, void 0, void 0, function* () {
        const enter = new Date().getTime();
        try {
            const result = yield handler.getDefinition(params);
            const exit = new Date().getTime();
            console.error('definition', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - enter) / 1000.0);
            return Promise.resolve(result || []);
        }
        catch (e) {
            console.error(params, e);
            return Promise.reject(e);
        }
    }));
    connection.onHover((params) => __awaiter(this, void 0, void 0, function* () {
        const enter = new Date().getTime();
        try {
            const result = yield handler.getHover(params);
            const exit = new Date().getTime();
            console.error('hover', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - enter) / 1000.0);
            return Promise.resolve(result || { contents: [] });
        }
        catch (e) {
            console.error(params, e);
            return Promise.reject(e);
        }
    }));
    connection.onReferences((params) => __awaiter(this, void 0, void 0, function* () {
        const enter = new Date().getTime();
        try {
            const result = yield handler.getReferences(params);
            const exit = new Date().getTime();
            console.error('references', params.textDocument.uri, params.position.line, params.position.character, 'found', result.length, 'total', (exit - enter) / 1000.0, 'busy', (exit - enter) / 1000.0);
            return Promise.resolve(result || []);
        }
        catch (e) {
            console.error(params, e);
            return Promise.reject(e);
        }
    }));
}
exports.registerLanguageHandler = registerLanguageHandler;
//# sourceMappingURL=connection.js.map