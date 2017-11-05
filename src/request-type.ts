import { Operation } from 'fast-json-patch'
import * as vscode from 'vscode-languageserver'

export interface InitializeParams extends vscode.InitializeParams {
    capabilities: ClientCapabilities
}

/**
 * Settings to enable plugin loading
 */
export interface PluginSettings {
    allowLocalPluginLoads: boolean
    globalPlugins: string[]
    pluginProbeLocations: string[]
}

export interface ClientCapabilities extends vscode.ClientCapabilities {
    /**
     * The client provides support for workspace/xfiles.
     */
    xfilesProvider?: boolean

    /**
     * The client provides support for textDocument/xcontent.
     */
    xcontentProvider?: boolean

    /**
     * The client provides support for cache/get and cache/set methods
     */
    xcacheProvider?: boolean

    /**
     * The client supports receiving the result solely through $/partialResult notifications for requests from the client to the server.
     */
    streaming?: boolean
}

export interface ServerCapabilities extends vscode.ServerCapabilities {
    xworkspaceReferencesProvider?: boolean
    xdefinitionProvider?: boolean
    xdependenciesProvider?: boolean
    xpackagesProvider?: boolean

    /**
     * The server supports receiving results solely through $/partialResult notifications for requests from the server to the client.
     */
    streaming?: boolean
}

export interface InitializeResult extends vscode.InitializeResult {
    capabilities: ServerCapabilities
}

export interface TextDocumentContentParams {
    /**
     * The text document to receive the content for.
     */
    textDocument: vscode.TextDocumentIdentifier
}

export interface WorkspaceFilesParams {
    /**
     * The URI of a directory to search.
     * Can be relative to the rootPath.
     * If not given, defaults to rootPath.
     */
    base?: string
}

/**
 * Represents information about a programming construct that can be used to identify and locate the
 * construct's symbol. The identification does not have to be unique, but it should be as unique as
 * possible. It is up to the language server to define the schema of this object.
 *
 * In contrast to `SymbolInformation`, `SymbolDescriptor` includes more concrete, language-specific,
 * metadata about the symbol.
 */
export interface SymbolDescriptor {
    /**
     * The kind of the symbol as a ts.ScriptElementKind
     */
    kind: string

    /**
     * The name of the symbol as returned from TS
     */
    name: string

    /**
     * The kind of the symbol the symbol is contained in, as a ts.ScriptElementKind.
     * Is an empty string if the symbol has no container.
     */
    containerKind: string

    /**
     * The name of the symbol the symbol is contained in, as returned from TS.
     * Is an empty string if the symbol has no container.
     */
    containerName: string

    /**
     * The file path of the file where the symbol is defined in, relative to the workspace rootPath.
     */
    filePath: string

    /**
     * A PackageDescriptor describing the package this symbol belongs to.
     * Is `undefined` if the symbol does not belong to a package.
     */
    package?: PackageDescriptor
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
    query?: string

    /**
     * A set of properties that describe the symbol to look up.
     */
    symbol?: Partial<SymbolDescriptor>
}

/*
 * WorkspaceReferenceParams holds parameters for the
 * workspace/xreferences endpoint (an extension of the original LSP
 * spec).
 */
export interface WorkspaceReferenceParams {
    /**
     * Metadata about the symbol that is being searched for.
     */
    query: Partial<SymbolDescriptor>

    /**
     * Hints provides optional hints about where the language server should look in order to find
     * the symbol (this is an optimization). It is up to the language server to define the schema of
     * this object.
     */
    hints?: DependencyHints
}

export interface SymbolLocationInformation {
    /**
     * The location where the symbol is defined, if any
     */
    location?: vscode.Location

    /**
     * Metadata about the symbol that can be used to identify or locate its definition.
     */
    symbol: SymbolDescriptor
}

/**
 * Represents information about a reference to programming constructs like variables, classes,
 * interfaces, etc.
 */
export interface ReferenceInformation {
    /**
     * The location in the workspace where the `symbol` is referenced.
     */
    reference: vscode.Location

    /**
     * Metadata about the symbol that can be used to identify or locate its definition.
     */
    symbol: SymbolDescriptor
}

export interface PackageInformation {
    package: PackageDescriptor
    dependencies: DependencyReference[]
}

export interface PackageDescriptor {
    name: string
    version?: string
    repoURL?: string
}

export interface DependencyHints {
    dependeePackageName?: string
}

export interface DependencyReference {
    attributes: PackageDescriptor
    hints: DependencyHints
}

/**
 * The cache get request is sent from the server to the client to request the value of a cache item
 * identified by the provided key.
 */
export interface CacheGetParams {
    /**
     * The key that identifies the cache item
     */
    key: string
}

/**
 * The cache set notification is sent from the server to the client to set the value of a cache item
 * identified by the provided key. This is a intentionally notification and not a request because
 * the server is not supposed to act differently if the cache set failed.
 */
export interface CacheSetParams {
    /**
     * The key that identifies the cache item
     */
    key: string

    /**
     * The value that should be saved
     */
    value: any
}

export interface PartialResultParams {
    /**
     * The request id to provide parts of the result for
     */
    id: number | string

    /**
     * A JSON Patch that represents updates to the partial result as specified in RFC6902
     * https://tools.ietf.org/html/rfc6902
     */
    patch: Operation[]
}

/**
 * Restriction on vscode's CompletionItem interface
 */
export interface CompletionItem extends vscode.CompletionItem {
    data?: CompletionItemData
}

/**
 * The necessary fields for a completion item details to be resolved by typescript
 */
export interface CompletionItemData {
    /**
     * The document from which the completion was requested
     */
    uri: string

    /**
     * The offset into the document at which the completion was requested
     */
    offset: number

    /**
     * The name field from typescript's returned completion entry
     */
    entryName: string
}
