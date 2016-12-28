/// <reference types="node" />
import * as vscode from 'vscode-languageserver';
import { LanguageHandler } from '../lang-handler';
import * as rt from '../request-type';
export declare function setUp(langhandler: LanguageHandler, memfs: any, done: (err?: Error) => void): void;
export declare function tearDown(done: () => void): void;
export declare function definition(pos: vscode.TextDocumentPositionParams, expected: vscode.Location | vscode.Location[] | null, done: (err?: Error) => void): void;
export declare function hover(pos: vscode.TextDocumentPositionParams, expected: vscode.Hover, done: (err?: Error) => void): void;
export declare function references(pos: vscode.TextDocumentPositionParams, expected: number, done: (err?: Error) => void): void;
export declare function workspaceReferences(params: rt.WorkspaceReferenceParams, expected: rt.ReferenceInformation[], done: (err?: Error) => void): void;
export declare function symbols(params: rt.WorkspaceSymbolParamsWithLimit, expected: vscode.SymbolInformation[], done: (err?: Error) => void): void;
export declare function documentSymbols(params: vscode.DocumentSymbolParams, expected: vscode.SymbolInformation[], done: (err?: Error) => void): void;
export declare function open(uri: string, text: string): void;
export declare function close(uri: string): void;
export declare function change(uri: string, text: string): void;
