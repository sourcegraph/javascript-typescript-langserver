import * as vscode from 'vscode-languageserver';

import * as fs from './fs';

export namespace GlobalRefsRequest {
    export const type: vscode.RequestType<vscode.WorkspaceSymbolParams, vscode.SymbolInformation[], any> = {
        get method() {
            return 'textDocument/global-refs';
        }
    };
}

export namespace InitializeRequest {
    export const type: vscode.RequestType<vscode.InitializeParams, vscode.InitializeResult, any> = {
        get method() {
            return 'initialize';
        }
    };
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

export namespace ReadDirRequest {
    export const type: vscode.RequestType<string, fs.FileInfo[], any> = {
        get method() {
            return 'fs/readDir';
        }
    };
}

export namespace ReadFileRequest {
    export const type: vscode.RequestType<string, string, any> = {
        get method() {
            return 'fs/readFile';
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

export interface WorkspaceSymbolParamsWithLimit {
    query: string;
    limit: number;
}

export namespace WorkspaceSymbolsRequest {
    export const type: vscode.RequestType<WorkspaceSymbolParamsWithLimit, vscode.SymbolInformation[], any> = {
        get method() {
            return 'workspace/symbol';
        }
    };
}
