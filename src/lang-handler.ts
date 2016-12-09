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
	Position,
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

import { FileSystem } from './fs';

import * as rt from './request-type';

/**
 * LanguageHandler handles LSP requests. It includes a handler method
 * for each LSP method that this language server supports. Each
 * handler method should be registered to the corresponding
 * registration method on IConnection.
 */
export interface LanguageHandler {
	initialize(params: InitializeParams, remoteFs: FileSystem, strict: boolean): Promise<InitializeResult>;
	getDefinition(params: TextDocumentPositionParams): Promise<Location[]>;
	getHover(params: TextDocumentPositionParams): Promise<Hover>;
	getReferences(params: ReferenceParams): Promise<Location[]>;
	getWorkspaceSymbols(params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]>;
	getDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]>;
	getWorkspaceReference(params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]>;
	didOpen(params: DidOpenTextDocumentParams);
	didChange(params: DidChangeTextDocumentParams);
	didClose(params: DidCloseTextDocumentParams);
	didSave(params: DidSaveTextDocumentParams);
}


