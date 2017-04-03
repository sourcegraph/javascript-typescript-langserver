import * as opentracing from 'opentracing';
import { CancellationToken } from 'vscode-jsonrpc';
import {
	CompletionList,
	DidChangeTextDocumentParams,
	DidCloseTextDocumentParams,
	DidOpenTextDocumentParams,
	DidSaveTextDocumentParams,
	DocumentSymbolParams,
	Hover,
	IConnection,
	InitializeParams,
	InitializeResult,
	Location,
	LogMessageParams,
	ReferenceParams,
	SymbolInformation,
	TextDocumentIdentifier,
	TextDocumentItem,
	TextDocumentPositionParams
} from 'vscode-languageserver';
import {
	DependencyReference,
	PackageInformation,
	ReferenceInformation,
	SymbolLocationInformation,
	TextDocumentContentParams,
	WorkspaceFilesParams,
	WorkspaceReferenceParams,
	WorkspaceSymbolParams
} from './request-type';

/**
 * LanguageHandler handles LSP requests. It includes a handler method
 * for each LSP method that this language server supports. Each
 * handler method should be registered to the corresponding
 * registration method on IConnection.
 */
export interface LanguageHandler {
	initialize(params: InitializeParams, span: opentracing.Span, token?: CancellationToken): Promise<InitializeResult>;
	shutdown(): Promise<void>;
	getDefinition(params: TextDocumentPositionParams, token?: CancellationToken): Promise<Location[]>;
	getXdefinition(params: TextDocumentPositionParams, token?: CancellationToken): Promise<SymbolLocationInformation[]>;
	getHover(params: TextDocumentPositionParams, token?: CancellationToken): Promise<Hover>;
	getReferences(params: ReferenceParams, token?: CancellationToken): Promise<Location[]>;
	getWorkspaceSymbols(params: WorkspaceSymbolParams, token?: CancellationToken): Promise<SymbolInformation[]>;
	getDocumentSymbol(params: DocumentSymbolParams, token?: CancellationToken): Promise<SymbolInformation[]>;
	getWorkspaceReference(params: WorkspaceReferenceParams, token?: CancellationToken): Promise<ReferenceInformation[]>;
	getPackages(params?: {}, token?: CancellationToken): Promise<PackageInformation[]>;
	getDependencies(params?: {}, token?: CancellationToken): Promise<DependencyReference[]>;
	didOpen(params: DidOpenTextDocumentParams, token?: CancellationToken): Promise<void>;
	didChange(params: DidChangeTextDocumentParams, token?: CancellationToken): Promise<void>;
	didClose(params: DidCloseTextDocumentParams, token?: CancellationToken): Promise<void>;
	didSave(params: DidSaveTextDocumentParams, token?: CancellationToken): Promise<void>;
	getCompletions(params: TextDocumentPositionParams, token?: CancellationToken): Promise<CompletionList>;
}

export interface LanguageClientHandler {
	getTextDocumentContent(params: TextDocumentContentParams, token?: CancellationToken): Promise<TextDocumentItem>;
	getWorkspaceFiles(params: WorkspaceFilesParams, token?: CancellationToken): Promise<TextDocumentIdentifier[]>;
	logMessage(params: LogMessageParams): void;
}

export class RemoteLanguageClient implements LanguageClientHandler {

	constructor(private connection: IConnection) {}

	getTextDocumentContent(params: TextDocumentContentParams, token = CancellationToken.None): Promise<TextDocumentItem> {
		return Promise.resolve(this.connection.sendRequest('textDocument/xcontent', params, token));
	}

	getWorkspaceFiles(params: WorkspaceFilesParams, token = CancellationToken.None): Promise<TextDocumentIdentifier[]> {
		return Promise.resolve(this.connection.sendRequest('workspace/xfiles', params, token));
	}

	logMessage(params: LogMessageParams): void {
		this.connection.sendNotification('window/logMessage', params);
	}
}
