import * as vscode from 'vscode-languageserver';

export namespace GlobalRefsRequest {
	export const type: vscode.RequestType<vscode.WorkspaceSymbolParams, vscode.SymbolInformation[], any> = {
		get method() {
			return 'textDocument/global-refs';
		}
	};
}

export namespace InitializeRequest {
	export const type: vscode.RequestType<vscode.InitializeParams, InitializeResult, any> = {
		get method() {
			return 'initialize';
		}
	};
}

export interface InitializeResult extends vscode.InitializeResult {
	/**
	 * The capabilities the language server provides.
	 */
	capabilities: ServerCapabilities;
}

export interface ServerCapabilities extends vscode.ServerCapabilities {
	xworkspaceReferencesProvider?: boolean;
	xdefinitionProvider?: boolean;
	xdependenciesProvider?: boolean;
	xpackagesProvider?: boolean;
}

export namespace ShutdownRequest {
	export const type = {
		get method() {
			return 'shutdown';
		}
	};
}

export namespace ExitRequest {
	export const type = {
		get method() {
			return 'exit';
		}
	};
}

export namespace DefinitionRequest {
	export const type: vscode.RequestType<vscode.TextDocumentPositionParams, vscode.Location[], any> = {
		get method() {
			return 'textDocument/definition';
		}
	};
}

export namespace XdefinitionRequest {
	export const type: vscode.RequestType<vscode.TextDocumentPositionParams, SymbolLocationInformation[], any> = {
		get method() {
			return 'textDocument/xdefinition';
		}
	};
}

export namespace HoverRequest {
	export const type: vscode.RequestType<vscode.TextDocumentPositionParams, vscode.Hover, any> = {
		get method() {
			return 'textDocument/hover';
		}
	};
}

export namespace ReferencesRequest {
	export const type: vscode.RequestType<vscode.ReferenceParams, vscode.Location[], any> = {
		get method() {
			return 'textDocument/references';
		}
	};
}

export namespace DependenciesRequest {
	export const type: vscode.RequestType<void, DependencyReference[], any> = {
		get method() {
			return 'workspace/xdependencies';
		}
	};
}

export namespace PackagesRequest {
	export const type: vscode.RequestType<void, PackageInformation[], any> = {
		get method() {
			return 'workspace/xpackages';
		}
	};
}

export namespace WorkspaceSymbolsRequest {
	export const type: vscode.RequestType<WorkspaceSymbolParams, vscode.SymbolInformation[], any> = {
		get method() {
			return 'workspace/symbol';
		}
	};
}

export namespace WorkspaceReferenceRequest {
	export const type: vscode.RequestType<WorkspaceReferenceParams, ReferenceInformation[], any> = {
		get method() {
			return 'workspace/xreferences';
		}
	};
}

export interface SymbolDescriptor {
	kind: string;
	name: string;
	containerKind: string;
	containerName: string;
	package?: PackageDescriptor;
}

export interface PartialSymbolDescriptor {
	kind?: string;
	name?: string;
	containerKind?: string;
	containerName?: string;
	package?: PackageDescriptor;
}

export namespace SymbolDescriptor {
	export function create(kind: string, name: string, containerKind: string, containerName: string, pkg?: PackageDescriptor): SymbolDescriptor {
		return { kind, name, containerKind, containerName, package: pkg };
	}
}

/*
 * WorkspaceReferenceParams holds parameters for the extended
 * workspace/symbols endpoint (an extension of the original LSP spec).
 * If both properties are set, the requirements are AND'd.
 */
export interface WorkspaceSymbolParams {
    /**
     * A non-empty query string.
     */
	query?: string;

	/**
	 * A set of properties that describe the symbol to look up.
	 */
	symbol?: PartialSymbolDescriptor;

	/**
	 * The number of items to which to restrict the results set size.
	 */
	limit: number;
}

/*
 * WorkspaceReferenceParams holds parameters for the
 * workspace/xreferences endpoint (an extension of the original LSP
 * spec).
 */
export interface WorkspaceReferenceParams {
	query: PartialSymbolDescriptor;
	hints?: DependencyHints;
}

export interface SymbolLocationInformation {
	location?: vscode.Location;
	symbol: SymbolDescriptor;
}

/*
 * ReferenceInformation enapsulates the metadata for a symbol
 * reference in code.
 */
export interface ReferenceInformation {
	reference: vscode.Location;
	symbol: SymbolDescriptor;
}

export interface PackageInformation {
	package: PackageDescriptor;
	dependencies: DependencyReference[];
}

export interface PackageDescriptor {
	name: string;
	version?: string;
	repoURL?: string;
}

export interface DependencyHints {
	dependeePackageName?: string;
}

export interface DependencyReference {
	attributes: PackageDescriptor;
	hints: DependencyHints;
}

export namespace DocumentSymbolRequest {
	export const type: vscode.RequestType<vscode.DocumentSymbolParams, vscode.SymbolInformation[], any> = {
		get method() {
			return 'textDocument/documentSymbol';
		}
	};
}

export namespace TextDocumentDidOpenNotification {
	export const type: vscode.NotificationType<vscode.DidOpenTextDocumentParams> = {
		get method() {
			return 'textDocument/didOpen';
		}
	};
}

export namespace TextDocumentDidCloseNotification {
	export const type: vscode.NotificationType<vscode.DidCloseTextDocumentParams> = {
		get method() {
			return 'textDocument/didClose';
		}
	};
}

export namespace TextDocumentDidSaveNotification {
	export const type: vscode.NotificationType<vscode.DidSaveTextDocumentParams> = {
		get method() {
			return 'textDocument/didSave';
		}
	};
}

export namespace TextDocumentDidChangeNotification {
	export const type: vscode.NotificationType<vscode.DidChangeTextDocumentParams> = {
		get method() {
			return 'textDocument/didChange';
		}
	};
}

export namespace TextDocumentCompletionRequest {
	export const type: vscode.RequestType<vscode.TextDocumentPositionParams, vscode.CompletionList, void> = {
		get method() {
			return 'textDocument/completion';
		}
	};
}
