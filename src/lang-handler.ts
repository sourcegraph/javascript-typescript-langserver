import {
	InitializeParams,
	InitializeResult,
	TextDocumentPositionParams,
	ReferenceParams,
	Location,
	Hover,
	DocumentSymbolParams,
	SymbolInformation,
	DidOpenTextDocumentParams,
	DidCloseTextDocumentParams,
	DidChangeTextDocumentParams,
	DidSaveTextDocumentParams,
	CompletionList
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
	shutdown(): Promise<void>;
	getDefinition(params: TextDocumentPositionParams): Promise<Location[]>;
	getXdefinition(params: TextDocumentPositionParams): Promise<rt.SymbolLocationInformation[]>;
	getHover(params: TextDocumentPositionParams): Promise<Hover>;
	getReferences(params: ReferenceParams): Promise<Location[]>;
	getWorkspaceSymbols(params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]>;
	getDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]>;
	getWorkspaceReference(params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]>;
	getDependencies(): Promise<rt.DependencyReference[]>;
	didOpen(params: DidOpenTextDocumentParams): Promise<void>;
	didChange(params: DidChangeTextDocumentParams): Promise<void>;
	didClose(params: DidCloseTextDocumentParams): Promise<void>;
	didSave(params: DidSaveTextDocumentParams): Promise<void>;
	getCompletions(params: TextDocumentPositionParams): Promise<CompletionList>;
}
