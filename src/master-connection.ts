import {
	IConnection,
	InitializeParams,
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

/**
 * registerMasterHandler registers a language server handler on the
 * main connection (first parameter) that delegates work to two
 * workers (accessible through the connections named by parameters one
 * and two). Worker one is the "canonical" worker. It receives all
 * requests sent to the master. Worker two is an auxiliary, used to
 * speed up certain operations that we would not like to block on
 * other operations. (Due to the constraints of the Node.js runtime,
 * the master and each worker has only one thread of execution.)
 *
 * On hover and definition requests, the master handler will return
 * the first successful response from either of the two workers. On
 * symbol and references requests, the master handler will only
 * delegate to worker one. On initialize, the master handler forwards
 * the request to both workers, but only returns the response from
 * worker one. All notifications are forwarded to both workers.
 *
 * @param master       The connection to register on
 * @param leigthWeight Connection for short-running requests
 * @param heavyDuty    Connection for long-running requests
 */
export function registerMasterHandler(master: IConnection, lightWeight: IConnection, heavyDuty: IConnection): void {

	// Forward calls from the worker to the master

	for (const worker of [lightWeight, heavyDuty]) {
		worker.onRequest({ method: 'workspace/xfiles' }, async (params: any): Promise<any> => {
			return master.sendRequest({ method: 'workspace/xfiles' }, params);
		});
		worker.onRequest({ method: 'textDocument/xcontent' }, async (params: any): Promise<any> => {
			return master.sendRequest({ method: 'textDocument/xcontent' }, params);
		});
	}

	// Forward initialize, shutdown

	master.onRequest(rt.InitializeRequest.type, async (params: InitializeParams): Promise<rt.InitializeResult> => {
		const [result] = await Promise.all([
			lightWeight.sendRequest(rt.InitializeRequest.type, params),
			heavyDuty.sendRequest(rt.InitializeRequest.type, params)
		]);
		return result;
	});

	master.onRequest({ method: 'shutdown' }, async () => {
		const [result] = await Promise.all([lightWeight, heavyDuty].map(worker => worker.sendRequest(rt.ShutdownRequest.type)));
		// Shutting down the master means killing the workers
		for (const worker of [lightWeight, heavyDuty]) {
			worker.sendNotification(rt.ExitRequest.type);
		}
		return result;
	});

	// Notifications (both workers)

	master.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
		for (const worker of [lightWeight, heavyDuty]) {
			worker.sendNotification(rt.TextDocumentDidOpenNotification.type, params)
		}
	});

	master.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
		for (const worker of [lightWeight, heavyDuty]) {
			worker.sendNotification(rt.TextDocumentDidChangeNotification.type, params);
		}
	});

	master.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => {
		for (const worker of [lightWeight, heavyDuty]) {
			worker.sendNotification(rt.TextDocumentDidSaveNotification.type, params);
		}
	});

	master.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
		for (const worker of [lightWeight, heavyDuty]) {
			worker.sendNotification(rt.TextDocumentDidCloseNotification.type, params);
		}
	});

	// Short-running requests (worker one)
	// These are all that can typically only need very specific files to be parsed

	master.onDefinition(async (params: TextDocumentPositionParams): Promise<Definition> => {
		return lightWeight.sendRequest(rt.DefinitionRequest.type, params);
	});

	master.onHover(async (params: TextDocumentPositionParams): Promise<Hover> => {
		return lightWeight.sendRequest(rt.HoverRequest.type, params);
	});

	// Long-running requests (worker two)
	// These are all that require compilation of the full workspace

	master.onRequest(rt.WorkspaceSymbolsRequest.type, async (params: rt.WorkspaceSymbolParams): Promise<SymbolInformation[]> => {
		return heavyDuty.sendRequest(rt.WorkspaceSymbolsRequest.type, params);
	});

	master.onRequest(rt.DocumentSymbolRequest.type, async (params: DocumentSymbolParams): Promise<SymbolInformation[]> => {
		return heavyDuty.sendRequest(rt.DocumentSymbolRequest.type, params);
	});

	master.onRequest(rt.WorkspaceReferenceRequest.type, async (params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]> => {
		return heavyDuty.sendRequest(rt.WorkspaceReferenceRequest.type, params);
	});

	master.onRequest(rt.DependenciesRequest.type, async (params: any): Promise<any> => {
		return heavyDuty.sendRequest(rt.DependenciesRequest.type, params);
	});

	master.onRequest(rt.XdefinitionRequest.type, async (params: any): Promise<any> => {
		return heavyDuty.sendRequest(rt.XdefinitionRequest.type, params);
	});

	master.onRequest(rt.GlobalRefsRequest.type, async (params: any): Promise<any> => {
		return heavyDuty.sendRequest(rt.GlobalRefsRequest.type, params);
	});

	master.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
		return heavyDuty.sendRequest(rt.ReferencesRequest.type, params);
	});

	master.onCompletion(async (params: any) => {
		return heavyDuty.sendRequest(rt.TextDocumentCompletionRequest.type, params);
	});
}
