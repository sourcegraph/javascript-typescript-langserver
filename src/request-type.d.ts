import * as vscode from 'vscode-languageserver';
import * as fs from './fs';
export declare namespace GlobalRefsRequest {
    const type: vscode.RequestType<vscode.WorkspaceSymbolParams, vscode.SymbolInformation[], any>;
}
export declare namespace InitializeRequest {
    const type: vscode.RequestType<vscode.InitializeParams, vscode.InitializeResult, any>;
}
export declare namespace ShutdownRequest {
    const type: {
        readonly method: string;
    };
}
export declare namespace ExitRequest {
    const type: {
        readonly method: string;
    };
}
export declare namespace ReadDirRequest {
    const type: vscode.RequestType<string, fs.FileInfo[], any>;
}
export declare namespace ReadFileRequest {
    const type: vscode.RequestType<string, string, any>;
}
export declare namespace DefinitionRequest {
    const type: vscode.RequestType<vscode.TextDocumentPositionParams, vscode.Location[], any>;
}
export declare namespace HoverRequest {
    const type: vscode.RequestType<vscode.TextDocumentPositionParams, vscode.Hover, any>;
}
export declare namespace ReferencesRequest {
    const type: vscode.RequestType<vscode.ReferenceParams, vscode.Location[], any>;
}
export interface WorkspaceSymbolParamsWithLimit {
    query: string;
    limit: number;
}
export declare namespace WorkspaceSymbolsRequest {
    const type: vscode.RequestType<WorkspaceSymbolParamsWithLimit, vscode.SymbolInformation[], any>;
}
export declare namespace WorkspaceReferenceRequest {
    const type: vscode.RequestType<WorkspaceReferenceParams, ReferenceInformation[], any>;
}
export interface WorkspaceReferenceParams {
}
export interface ReferenceInformation {
    location: vscode.Location;
    name: string;
    containerName: string;
    uri: string;
}
export declare namespace DocumentSymbolRequest {
    const type: vscode.RequestType<vscode.DocumentSymbolParams, vscode.SymbolInformation[], any>;
}
export declare namespace TextDocumentDidOpenNotification {
    const type: vscode.NotificationType<vscode.DidOpenTextDocumentParams>;
}
export declare namespace TextDocumentDidCloseNotification {
    const type: vscode.NotificationType<vscode.DidCloseTextDocumentParams>;
}
export declare namespace TextDocumentDidSaveNotification {
    const type: vscode.NotificationType<vscode.DidSaveTextDocumentParams>;
}
export declare namespace TextDocumentDidChangeNotification {
    const type: vscode.NotificationType<vscode.DidChangeTextDocumentParams>;
}
