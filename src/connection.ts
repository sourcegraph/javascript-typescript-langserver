import {
	IConnection,
	createConnection,
	InitializeParams,
	InitializeResult,
	TextDocumentPositionParams,
	Definition,
	ReferenceParams,
	Location,
	Hover,
	DocumentSymbolParams,
	SymbolInformation,
	DidOpenTextDocumentParams,
	DidCloseTextDocumentParams,
	DidChangeTextDocumentParams,
	DidSaveTextDocumentParams
} from 'vscode-languageserver';

import * as util from './util';
import * as fs from './fs';
import * as rt from './request-type';

import { LanguageHandler } from './lang-handler';

export function newConnection(input: any, output: any): IConnection {
	const connection = createConnection(input, output);
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

export function registerLanguageHandler(connection: IConnection, strict: boolean, handler: LanguageHandler): void {
	connection.onRequest(rt.InitializeRequest.type, async (params: InitializeParams): Promise<InitializeResult> => {
		console.error('initialize', params.rootPath);
		let remoteFs: fs.FileSystem;
		if (strict) {
			remoteFs = new fs.RemoteFileSystem(connection);
		} else {
			remoteFs = new fs.LocalFileSystem(util.uri2path(params.rootPath));
		}
		try {
			return await handler.initialize(params, remoteFs, strict);
		} catch (e) {
			console.error(params, e);
			return Promise.reject(e);
		}
	});

	connection.onShutdown(() => handler.shutdown());

	connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => handler.didOpen(params));
	connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => handler.didChange(params));
	connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => handler.didSave(params));
	connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => handler.didClose(params));

	connection.onRequest(rt.WorkspaceSymbolsRequest.type, async (params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]> => {
		const enter = new Date().getTime();
		try {
			const result = await handler.getWorkspaceSymbols(params);
			const exit = new Date().getTime();
			console.error('workspace/symbol', params.query, (exit - enter) / 1000.0);
			return Promise.resolve(result || []);
		} catch (e) {
			console.error(params, e);
			return Promise.reject(e);
		}
	});

	connection.onRequest(rt.DocumentSymbolRequest.type, async (params: DocumentSymbolParams): Promise<SymbolInformation[]> => {
		const enter = new Date().getTime();
		try {
			const result = await handler.getDocumentSymbol(params);
			const exit = new Date().getTime();
			console.error('textDocument/documentSymbol', params.textDocument.uri, (exit - enter) / 1000.0);
			return Promise.resolve(result || []);
		} catch (e) {
			console.error(params, e);
			return Promise.reject(e);
		}
	});

	connection.onRequest(rt.WorkspaceReferenceRequest.type, async (params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]> => {
		const enter = new Date().getTime();
		try {
			const result = await handler.getWorkspaceReference(params);
			const exit = new Date().getTime();
			console.error('workspace/reference', (exit - enter) / 1000.0);
			return Promise.resolve(result || []);
		} catch (e) {
			console.error(params, e);
			return Promise.reject(e);
		}
	});

	connection.onDefinition(async (params: TextDocumentPositionParams): Promise<Definition> => {
		const enter = new Date().getTime();
		try {
			const result = await handler.getDefinition(params);
			const exit = new Date().getTime();
			console.error('definition', docid(params), (exit - enter) / 1000.0);
			return Promise.resolve(result || []);
		} catch (e) {
			console.error(params, e);
			return Promise.reject(e);
		}
	});

	connection.onHover(async (params: TextDocumentPositionParams): Promise<Hover> => {
		const enter = new Date().getTime();
		try {
			const result = await handler.getHover(params);
			const exit = new Date().getTime();
			console.error('hover', docid(params), (exit - enter) / 1000.0);
			return Promise.resolve(result || { contents: [] });
		} catch (e) {
			console.error(params, e);
			return Promise.reject(e);
		}
	});

	connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
		const enter = new Date().getTime();
		try {
			const result = await handler.getReferences(params);
			const exit = new Date().getTime();
			console.error('references', docid(params), 'found', result.length, (exit - enter) / 1000.0);
			return Promise.resolve(result || []);
		} catch (e) {
			console.error(params, e);
			return Promise.reject(e);
		}
	});
}

function docid(params: TextDocumentPositionParams): string {
	return params.textDocument.uri + ':' + params.position.line + ':' + params.position.character;
}