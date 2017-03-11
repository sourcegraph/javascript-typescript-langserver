import * as vscode from 'vscode-languageserver';

export interface InitializeParams extends vscode.InitializeParams {
	capabilities: ClientCapabilities;
}

export interface ClientCapabilities {
	xfilesProvider?: boolean;
	xcontentProvider?: boolean;
}

export interface ServerCapabilities extends vscode.ServerCapabilities {
	xworkspaceReferencesProvider?: boolean;
	xdefinitionProvider?: boolean;
	xdependenciesProvider?: boolean;
	xpackagesProvider?: boolean;
}

export interface TextDocumentContentParams {
	textDocument: vscode.TextDocumentIdentifier;
}

export interface WorkspaceFilesParams {
	base?: string;
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
	limit?: number;
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
