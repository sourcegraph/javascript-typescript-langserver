"use strict";
var GlobalRefsRequest;
(function (GlobalRefsRequest) {
    GlobalRefsRequest.type = {
        get method() {
            return 'textDocument/global-refs';
        }
    };
})(GlobalRefsRequest = exports.GlobalRefsRequest || (exports.GlobalRefsRequest = {}));
var InitializeRequest;
(function (InitializeRequest) {
    InitializeRequest.type = {
        get method() {
            return 'initialize';
        }
    };
})(InitializeRequest = exports.InitializeRequest || (exports.InitializeRequest = {}));
var ShutdownRequest;
(function (ShutdownRequest) {
    ShutdownRequest.type = {
        get method() {
            return 'shutdown';
        }
    };
})(ShutdownRequest = exports.ShutdownRequest || (exports.ShutdownRequest = {}));
var ExitRequest;
(function (ExitRequest) {
    ExitRequest.type = {
        get method() {
            return 'exit';
        }
    };
})(ExitRequest = exports.ExitRequest || (exports.ExitRequest = {}));
var ReadDirRequest;
(function (ReadDirRequest) {
    ReadDirRequest.type = {
        get method() {
            return 'fs/readDir';
        }
    };
})(ReadDirRequest = exports.ReadDirRequest || (exports.ReadDirRequest = {}));
var ReadFileRequest;
(function (ReadFileRequest) {
    ReadFileRequest.type = {
        get method() {
            return 'fs/readFile';
        }
    };
})(ReadFileRequest = exports.ReadFileRequest || (exports.ReadFileRequest = {}));
var DefinitionRequest;
(function (DefinitionRequest) {
    DefinitionRequest.type = {
        get method() {
            return 'textDocument/definition';
        }
    };
})(DefinitionRequest = exports.DefinitionRequest || (exports.DefinitionRequest = {}));
var HoverRequest;
(function (HoverRequest) {
    HoverRequest.type = {
        get method() {
            return 'textDocument/hover';
        }
    };
})(HoverRequest = exports.HoverRequest || (exports.HoverRequest = {}));
var ReferencesRequest;
(function (ReferencesRequest) {
    ReferencesRequest.type = {
        get method() {
            return 'textDocument/references';
        }
    };
})(ReferencesRequest = exports.ReferencesRequest || (exports.ReferencesRequest = {}));
var WorkspaceSymbolsRequest;
(function (WorkspaceSymbolsRequest) {
    WorkspaceSymbolsRequest.type = {
        get method() {
            return 'workspace/symbol';
        }
    };
})(WorkspaceSymbolsRequest = exports.WorkspaceSymbolsRequest || (exports.WorkspaceSymbolsRequest = {}));
var WorkspaceReferenceRequest;
(function (WorkspaceReferenceRequest) {
    WorkspaceReferenceRequest.type = {
        get method() {
            return 'workspace/reference';
        }
    };
})(WorkspaceReferenceRequest = exports.WorkspaceReferenceRequest || (exports.WorkspaceReferenceRequest = {}));
var DocumentSymbolRequest;
(function (DocumentSymbolRequest) {
    DocumentSymbolRequest.type = {
        get method() {
            return "textDocument/documentSymbol";
        }
    };
})(DocumentSymbolRequest = exports.DocumentSymbolRequest || (exports.DocumentSymbolRequest = {}));
var TextDocumentDidOpenNotification;
(function (TextDocumentDidOpenNotification) {
    TextDocumentDidOpenNotification.type = {
        get method() {
            return 'textDocument/didOpen';
        }
    };
})(TextDocumentDidOpenNotification = exports.TextDocumentDidOpenNotification || (exports.TextDocumentDidOpenNotification = {}));
var TextDocumentDidCloseNotification;
(function (TextDocumentDidCloseNotification) {
    TextDocumentDidCloseNotification.type = {
        get method() {
            return 'textDocument/didClose';
        }
    };
})(TextDocumentDidCloseNotification = exports.TextDocumentDidCloseNotification || (exports.TextDocumentDidCloseNotification = {}));
var TextDocumentDidSaveNotification;
(function (TextDocumentDidSaveNotification) {
    TextDocumentDidSaveNotification.type = {
        get method() {
            return 'textDocument/didSave';
        }
    };
})(TextDocumentDidSaveNotification = exports.TextDocumentDidSaveNotification || (exports.TextDocumentDidSaveNotification = {}));
var TextDocumentDidChangeNotification;
(function (TextDocumentDidChangeNotification) {
    TextDocumentDidChangeNotification.type = {
        get method() {
            return 'textDocument/didChange';
        }
    };
})(TextDocumentDidChangeNotification = exports.TextDocumentDidChangeNotification || (exports.TextDocumentDidChangeNotification = {}));
//# sourceMappingURL=request-type.js.map