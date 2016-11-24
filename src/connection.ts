/// <reference path="../node_modules/vscode/thenable.d.ts"/>

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

		this.connection.onRequest(rt.InitializeRequest.type, (params: InitializeParams): Promise<InitializeResult> => {
			console.error('initialize', params.rootPath);
			return new Promise<InitializeResult>((resolve) => {
				if (params.rootPath) {
					workspaceRoot = util.uri2path(params.rootPath);
					service = new TypeScriptService(workspaceRoot, strict, this.connection);
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

		this.connection.onNotification(rt.ExitRequest.type, close);

		this.connection.onRequest(rt.ShutdownRequest.type, () => []);

		this.connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
			const reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
			service.didOpen(reluri, params.textDocument.text);
		});

		this.connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
			const reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
			let text = null;
			params.contentChanges.forEach((change) => {
				if (change.range || change.rangeLength) {
					throw new Error('incremental updates in textDocument/didChange not supported for file ' + params.textDocument.uri);
				}
				text = change.text;
			});
			if (!text) {
				return;
			}
			service.didChange(reluri, text);
		});

		this.connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => {
			const reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
			service.didSave(reluri);
		});

		this.connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
			const reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
			service.didClose(reluri);
		});


		this.connection.onRequest(rt.WorkspaceSymbolsRequest.type, (params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]> => {
			const enter = new Date().getTime();
			return new Promise<SymbolInformation[]>((resolve, reject) => {
				let result = [];
				const init = new Date().getTime();
				try {
					return service.getWorkspaceSymbols(params.query, params.limit).then((result) => {
						result = result ? result : [];
						const exit = new Date().getTime();
						console.error('symbol', params.query, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						return resolve(result);
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
					let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
					service.getDefinition(reluri, params.position.line, params.position.character).then((result) => {
						result = result ? result : [];

						const exit = new Date().getTime();
						console.error('definition', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						return resolve(result);
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
					let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
					service.getHover(reluri, params.position.line, params.position.character).then((hover) => {
						hover = hover ? hover : { contents: [] };
						const exit = new Date().getTime();
						console.error('hover', params.textDocument.uri, params.position.line, params.position.character, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						resolve(hover);
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
					let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
					service.getReferences(reluri, params.position.line, params.position.character).then((result) => {
						result = result ? result : [];

						const exit = new Date().getTime();
						console.error('references', params.textDocument.uri, params.position.line, params.position.character, 'found', result.length, 'total', (exit - enter) / 1000.0, 'busy', (exit - init) / 1000.0, 'wait', (init - enter) / 1000.0);
						return resolve(result);
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

	sendRequest<P, R, E>(type: RequestType<P, R, E>, params?: P): Thenable<R> {
		return this.connection.sendRequest(type, params);
	}

}
