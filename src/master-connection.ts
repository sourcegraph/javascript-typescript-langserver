import {
	IConnection,
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

import * as rt from './request-type';

export function registerMasterHandler(connection: IConnection, one: IConnection, two: IConnection): void {
	connection.onRequest(rt.InitializeRequest.type, async (params: InitializeParams): Promise<InitializeResult> => {
		const resultOne = one.sendRequest(rt.InitializeRequest.type, params);
		two.sendRequest(rt.InitializeRequest.type, params);
		return resultOne;
	});

	connection.onShutdown(() => {
		for (const worker of [one, two]) {
			worker.sendRequest(rt.ShutdownRequest.type);

			// The master's exit notification is not forwarded to the worker, so send it here.
			worker.sendNotification(rt.ExitRequest.type);
		}
	});

	connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
		for (const worker of [one, two]) {
			worker.sendNotification(rt.TextDocumentDidOpenNotification.type, params)
		}
	});

	connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
		for (const worker of [one, two]) {
			worker.sendNotification(rt.TextDocumentDidChangeNotification.type, params);
		}
	});

	connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => {
		for (const worker of [one, two]) {
			worker.sendNotification(rt.TextDocumentDidSaveNotification.type, params);
		}
	});

	connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
		for (const worker of [one, two]) {
			worker.sendNotification(rt.TextDocumentDidCloseNotification.type, params);
		}
	});

	connection.onDefinition(async (params: TextDocumentPositionParams): Promise<Definition> => {
		const resps = [one, two].map((worker) => {
			return worker.sendRequest(rt.DefinitionRequest.type, params);
		});
		return promiseFirstSuccess(resps);
	});

	connection.onHover(async (params: TextDocumentPositionParams): Promise<Hover> => {
		const resps = [one, two].map((worker) => {
			return worker.sendRequest(rt.HoverRequest.type, params);
		});
		return promiseFirstSuccess(resps);
	});

	connection.onRequest(rt.WorkspaceSymbolsRequest.type, async (params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]> => {
		return one.sendRequest(rt.WorkspaceSymbolsRequest.type, params);
	});

	connection.onRequest(rt.DocumentSymbolRequest.type, async (params: DocumentSymbolParams): Promise<SymbolInformation[]> => {
		return one.sendRequest(rt.DocumentSymbolRequest.type, params);
	});

	connection.onRequest(rt.WorkspaceReferenceRequest.type, async (params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]> => {
		return one.sendRequest(rt.WorkspaceReferenceRequest.type, params);
	});

	connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
		return one.sendRequest(rt.ReferencesRequest.type, params);
	});
}

function promiseFirstSuccess<T>(promises: Thenable<T>[]): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let doneCt = 0;
		for (const p of promises) {
			p.then((result) => {
				doneCt++;
				if (doneCt > 1) {
					return;
				}
				return resolve(result);
			}, (err) => {
				doneCt++;
				if (doneCt === 2) {
					return reject(err);
				}
				return;
			});
		}
	});
}
