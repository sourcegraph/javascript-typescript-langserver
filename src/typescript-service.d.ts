import { InitializeParams, InitializeResult, TextDocumentPositionParams, ReferenceParams, Location, Hover, DocumentSymbolParams, SymbolInformation, DidOpenTextDocumentParams, DidCloseTextDocumentParams, DidChangeTextDocumentParams, DidSaveTextDocumentParams } from 'vscode-languageserver';
import * as FileSystem from './fs';
import * as pm from './project-manager';
import * as rt from './request-type';
import { LanguageHandler } from './lang-handler';
/**
 * TypeScriptService handles incoming requests and return
 * responses. There is a one-to-one-to-one correspondence between TCP
 * connection, TypeScriptService instance, and language
 * workspace. TypeScriptService caches data from the compiler across
 * requests. The lifetime of the TypeScriptService instance is tied to
 * the lifetime of the TCP connection, so its caches are deleted after
 * the connection is torn down.
 */
export declare class TypeScriptService implements LanguageHandler {
    projectManager: pm.ProjectManager;
    root: string;
    private strict;
    private emptyQueryWorkspaceSymbols;
    private initialized;
    private traceModuleResolution;
    constructor(traceModuleResolution?: boolean);
    initialize(params: InitializeParams, remoteFs: FileSystem.FileSystem, strict: boolean): Promise<InitializeResult>;
    shutdown(): Promise<void>;
    getDefinition(params: TextDocumentPositionParams): Promise<Location[]>;
    getHover(params: TextDocumentPositionParams): Promise<Hover | null>;
    getReferences(params: ReferenceParams): Promise<Location[]>;
    getWorkspaceSymbols(params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]>;
    getDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]>;
    getWorkspaceReference(params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]>;
    private walkMostAST(node, visit);
    didOpen(params: DidOpenTextDocumentParams): Promise<void>;
    didChange(params: DidChangeTextDocumentParams): Promise<void>;
    didSave(params: DidSaveTextDocumentParams): Promise<void>;
    didClose(params: DidCloseTextDocumentParams): Promise<void>;
    /**
     * Fetches (or creates if needed) source file object for a given file name
     * @param configuration project configuration
     * @param fileName file name to fetch source file for or create it
     */
    private getSourceFile(configuration, fileName);
    /**
     * Produces async function that converts ReferenceEntry object to Location
     */
    private transformReference(root, program, ref);
    /**
     * transformNavItem transforms a NavigateToItem instance to a SymbolInformation instance
     */
    private transformNavItem(root, program, item);
    private collectWorkspaceSymbols(query, configs);
    /**
     * Transforms definition's file name to URI. If definition belongs to TypeScript library,
     * returns git://github.com/Microsoft/TypeScript URL, otherwise returns file:// one
     */
    private defUri(filePath);
    /**
     * Fetches up to limit navigation bar items from given project, flattens them
     */
    private getNavigationTreeItems(configuration, limit?);
    /**
     * Flattens navigation tree by transforming it to one-dimensional array.
     * Some items (source files, modules) may be excluded
     */
    private flattenNavigationTreeItem(item, parent, sourceFile, result, limit?);
    /**
     * Transforms NavigationTree to SymbolInformation
     */
    private transformNavigationTreeItem(item, parent, sourceFile);
    /**
     * @return true if navigation tree item is acceptable for inclusion into workspace/symbols
     */
    private static isAcceptableNavigationTreeItem(item);
}
