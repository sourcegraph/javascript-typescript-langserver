/// <reference path="../node_modules/vscode/thenable.d.ts"/>

import {
	IConnection,
	createConnection,
	InitializeParams,
	InitializeResult,
	TextDocuments,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	Definition,
	ReferenceParams,
	Location,
	Hover,
	WorkspaceSymbolParams,
	DocumentSymbolParams,
	SymbolInformation,
	RequestType,
	Range,
	DidOpenTextDocumentParams,
	DidCloseTextDocumentParams,
	DidChangeTextDocumentParams,
	DidSaveTextDocumentParams
} from 'vscode-languageserver';

import * as ts from 'typescript';
import * as types from 'vscode-languageserver-types';

import * as util from './util';
import TypeScriptService from './typescript-service';

import * as rt from './request-type';

/**
 * Connection handles incoming requests and sends responses over the
 * JSONRPC connection. There is one Connection instance created for
 * each workspace. Connection also includes cached data from the
 * compiler that lets it respond more quickly. These caches are
 * deleted after the Connection is torn down.
 */
export default class Connection {

	connection: IConnection;

	constructor(input: any, output: any, strict: boolean) {

		this.connection = createConnection(input, output);

		input.removeAllListeners('end');
		input.removeAllListeners('close');
		output.removeAllListeners('end');
		output.removeAllListeners('close');

		let workspaceRoot: string;
		let closed = false;

		function close() {
			if (!closed) {
				input.close();
				output.close();
				closed = true;
			}
		}
		const service = new TypeScriptService();

		this.connection.onRequest(rt.InitializeRequest.type, (params: InitializeParams): Promise<InitializeResult> => {
			console.error('initialize', params.rootPath);
			return service.initialize(params, this.connection, strict);
		});

		this.connection.onNotification(rt.ExitRequest.type, close);
		this.connection.onRequest(rt.ShutdownRequest.type, () => []);

		this.connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => service.didOpen(params));
		this.connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => service.didChange(params));
		this.connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => service.didSave(params));
		this.connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => service.didClose(params));

		this.connection.onRequest(rt.WorkspaceSymbolsRequest.type, (params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]> => {
			const enter = new Date().getTime();
			return new Promise<SymbolInformation[]>((resolve, reject) => {
				const init = new Date().getTime();
				try {
					return service.getWorkspaceSymbols(params).then((result) => {
						const exit = new Date().getTime();
						console.error('workspace/symbol', params.query, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						return resolve(result || []);
					});
				} catch (e) {
					console.error(params, e);
					return resolve([]);
				}
			});
		});

		this.connection.onRequest(rt.DocumentSymbolRequest.type, (params: DocumentSymbolParams): Promise<SymbolInformation[]> => {
			const enter = new Date().getTime();
			return new Promise<SymbolInformation[]>((resolve, reject) => {
				const init = new Date().getTime();
				try {
					return service.getDocumentSymbol(params).then((result) => {
						const exit = new Date().getTime();
						console.error('textDocument/documentSymbol', "", 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						return resolve(result || []);
					});
				} catch (e) {
					console.error(params, e);
					return resolve([]);
				}
			});
		});

		this.connection.onRequest(rt.WorkspaceReferenceRequest.type, (params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]> => {
			const enter = new Date().getTime();
			return new Promise<rt.ReferenceInformation[]>((resolve, reject) => {
				const init = new Date().getTime();
				try {
					return service.getWorkspaceReference(params).then((result) => {
						const exit = new Date().getTime();
						console.error('workspace/reference', 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						return resolve(result || []);
					});
				} catch (e) {
					console.error(params, e);
					return resolve([]);
				}
			});
		});


		this.connection.onDefinition((params: TextDocumentPositionParams): Promise<Definition> => {
			const enter = new Date().getTime();
			return new Promise<Definition>((resolve, reject) => {
				try {
					const init = new Date().getTime();
					service.getDefinition(params).then((result) => {
						const exit = new Date().getTime();
						console.error('definition', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						return resolve(result || []);
					}, (e) => {
						return reject(e);
					});
				} catch (e) {
					console.error(params, e);
					return resolve([]);
				}
			});
		});

		this.connection.onHover((params: TextDocumentPositionParams): Promise<Hover> => {
			const enter = new Date().getTime();
			return new Promise<Hover>((resolve, reject) => {
				const init = new Date().getTime();
				try {
					service.getHover(params).then((hover) => {
						const exit = new Date().getTime();
						console.error('hover', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						resolve(hover || { contents: [] });
					}, (e) => {
						return reject(e);
					});
				} catch (e) {
					console.error(params, e);
					resolve({ contents: [] });
				}
			});
		});

		this.connection.onReferences((params: ReferenceParams): Promise<Location[]> => {
			return new Promise<Location[]>((resolve, reject) => {
				const enter = new Date().getTime();
				const init = new Date().getTime();
				try {
					service.getReferences(params).then((result) => {
						const exit = new Date().getTime();
						console.error('references', params.textDocument.uri, params.position.line, params.position.character, 'found', result.length, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						return resolve(result || []);
					}
					);
				} catch (e) {
					console.error(params, e);
					return resolve([]);
				}
			});
		});
	}

	start() {
		this.connection.listen();
	}

	// TODO(beyang): remove
	sendRequest<P, R, E>(type: RequestType<P, R, E>, params?: P): Thenable<R> {
		return this.connection.sendRequest(type, params);
	}
}
