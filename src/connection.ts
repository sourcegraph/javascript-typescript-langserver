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
import { Message, StreamMessageReader, StreamMessageWriter, DataCallback } from 'vscode-jsonrpc';

import * as fs_ from 'fs';
import { EOL } from 'os';

import * as util from './util';
import * as fs from './fs';
import * as rt from './request-type';

import { LanguageHandler } from './lang-handler';

/**
 * Tracing options control dumping request/responses to stderr and optional file
 */
export interface TraceOptions {
	trace?: boolean;
	logfile?: string;
}

export function newConnection(input: any, output: any, trace: TraceOptions): IConnection {

	const reader = new StreamMessageReader(input);

	var logger: fs_.WriteStream = null;
	if (trace.trace && trace.logfile) {
		try {
			logger = fs_.createWriteStream(trace.logfile, { 'flags': 'a', encoding: 'utf-8' });
		} catch (e) {
			console.error('Unable to initialize logger', e);
		}
	}

	const _listen = reader.listen.bind(reader);
	reader.listen = function (callback: DataCallback): void {
		const tracer = (message: Message): void => {
			doTrace(message, trace, logger, '-->');
			callback(message);
		};
		_listen(tracer);
	};

	const writer = new StreamMessageWriter(output);
	const _write = writer.write.bind(writer);
	writer.write = function (message: Message) {
		doTrace(message, trace, logger, '<--');
		_write(message);
	}

	const connection = createConnection(reader, writer);
	input.removeAllListeners('end');
	input.removeAllListeners('close');
	output.removeAllListeners('end');
	output.removeAllListeners('close');

	let closed = false;
	function close() {
		if (!closed) {
			if ((<fs_.ReadStream>input).close) {
				(<fs_.ReadStream>input).close();
			}
			if ((<fs_.WriteStream>output).close) {
				(<fs_.WriteStream>output).close();
			}
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

	connection.onShutdown(() => {
		handler.shutdown().catch((e) => {
			console.error("shutdown failed:", e);
		});
	});

	connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
		handler.didOpen(params).catch((e) => {
			console.error("textDocument/didOpen failed:", e);
		});
	});

	connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
		handler.didChange(params).catch((e) => {
			console.error("textDocument/didChange failed:", e);
		});
	});

	connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => {
		handler.didSave(params).catch((e) => {
			console.error("textDocument/didSave failed:", e);
		});
	});

	connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
		handler.didClose(params).catch((e) => {
			console.error("textDocument/didClose failed:", e);
		});
	});

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
			console.error('workspace/xreferences', (exit - enter) / 1000.0);
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

	connection.onRequest(rt.XdefinitionRequest.type, async (params: TextDocumentPositionParams): Promise<rt.SymbolLocationInformation[]> => {
		const enter = new Date().getTime();
		try {
			const result = await handler.getXdefinition(params);
			const exit = new Date().getTime();
			console.error('xdefinition', docid(params), (exit - enter) / 1000.0);
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

	connection.onRequest(rt.DependenciesRequest.type, async (): Promise<rt.DependencyReference[]> => {
		const enter = new Date().getTime();
		try {
			const result = await handler.getDependencies();
			const exit = new Date().getTime();
			console.error('dependencies found', result.length, (exit - enter) / 1000.0);
			return Promise.resolve(result || []);
		} catch (e) {
			console.error(e);
			return Promise.reject(e);
		}
	});
}

function docid(params: TextDocumentPositionParams): string {
	return params.textDocument.uri + ':' + params.position.line + ':' + params.position.character;
}

function dump(message: Message): string {
	return JSON.stringify(message);
}

function doTrace(message: Message, options: TraceOptions, stream: fs_.WriteStream, prefix: string) {
	if (options.trace) {
		const text = prefix + ' ' + dump(message);
		console.error(text);
		if (stream) {
			try {
				stream.write(text + EOL);
			} catch (e) {
				// ignore
			}
		}
	}

}