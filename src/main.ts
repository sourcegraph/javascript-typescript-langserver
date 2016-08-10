/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');

import * as ts from 'typescript';
import * as util from './util';

import {
	InitializeParams, InitializeResult,
	TextDocuments,
	TextDocumentPositionParams, Definition, ReferenceParams, Location, Hover, WorkspaceSymbolParams,
	SymbolInformation, SymbolKind, Range
} from 'vscode-languageserver';

import TypeScriptService from './typescript';
import Connection from './connection';

// namespace VSCodeContentRequest {
// 	export const type: RequestType<TextDocumentPositionParams, string, any> = { get method() { return 'textDocument/externals'; } };
// }

// connection.connection.onRequest(VSCodeContentRequest.type, (params: TextDocumentPositionParams): string => {
// 	console.log('externals', params.textDocument.uri, params.position.line, params.position.character)

// 	return "";
// });

var server = net.createServer(function (socket) {
	let connection: Connection = new Connection(socket);
	let documents: TextDocuments = new TextDocuments();

	connection.connection.onInitialize((params: InitializeParams): InitializeResult => {
		console.log('initialize', params.rootPath);
		connection.service = new TypeScriptService(params.rootPath);
		return {
			capabilities: {
				// Tell the client that the server works in FULL text document sync mode
				textDocumentSync: documents.syncKind,
				hoverProvider: true,
				definitionProvider: true,
				referencesProvider: true
			}
		}
	});

	connection.connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
		try {
			console.log('workspace symbols', params.query);
			if (params.query == "exported") {
				const exported = connection.service.getExportedEnts();
				let res = exported.map(ent => {
					// return SymbolInformation.create(ent.name, ent.kind, Range.create(ent.location.pos, ent.location.end),
					// 	'file:///' + ent.location.file, util.formExternalUri(ent));
					return SymbolInformation.create(ent.name, ent.kind, util.formEmptyRange(),
						'file:///' + ent.location.file, util.formExternalUri(ent));
				});
				console.error("exported res = ", res);
				return res;
			} else if (params.query == "externals") {
				const externals = connection.service.getExternalRefs();
				let res = externals.map(external => {
					return SymbolInformation.create(external.name, util.formEmptyKind(), util.formEmptyRange(), util.formExternalUri(external));
				});
				console.error("symbols res = ", res);
				return res;
			}
			return [];
		} catch (e) {
			console.error(params, e);
			return [];
		}
	});

	connection.connection.onDefinition((params: TextDocumentPositionParams): Definition => {
		try {
			console.log('definition', params.textDocument.uri, params.position.line, params.position.character)
			const defs: ts.DefinitionInfo[] = connection.service.getDefinition(params.textDocument.uri, params.position.line, params.position.character);
			let result: Location[] = [];
			if (defs) {
				for (let def of defs) {
					result.push(Location.create('file:///' + def.fileName, {
						start: connection.service.position(def.fileName, def.textSpan.start),
						end: connection.service.position(def.fileName, def.textSpan.start + def.textSpan.length)
					}));
				}
			} else {
				//check whether definition is external, if uri string returned, add this location
				let externalDef = connection.service.getExternalDefinition(params.textDocument.uri, params.position.line, params.position.character);
				if (externalDef) {
					result.push(Location.create(externalDef, util.formEmptyRange()));
				}
			}
			return result;
		} catch (e) {
			console.error(params, e);
			return [];
		}
	});

	connection.connection.onHover((params: TextDocumentPositionParams): Hover => {
		try {
			console.log('hover', params.textDocument.uri, params.position.line, params.position.character);
			const quickInfo: ts.QuickInfo = connection.service.getHover(params.textDocument.uri, params.position.line, params.position.character);
			let result: Hover = { contents: util.formHover(quickInfo) };
			return result;
		} catch (e) {
			console.error(params, e);
			return { contents: [] };
		}
	});

	connection.connection.onReferences((params: ReferenceParams): Location[] => {
		try {
			console.log('references', params.textDocument.uri, params.position.line, params.position.character);
			const refEntries: ts.ReferenceEntry[] = connection.service.getReferences(params.textDocument.uri, params.position.line, params.position.character);
			const result: Location[] = [];
			if (refEntries) {
				for (let ref of refEntries) {
					result.push(Location.create('file:///' + ref.fileName, {
						start: connection.service.position(ref.fileName, ref.textSpan.start),
						end: connection.service.position(ref.fileName, ref.textSpan.start + ref.textSpan.length)
					}));

				}
			}
			return result;
		} catch (e) {
			console.error(params, e);
			return [];
		}
	});

	connection.connection.onShutdown(() => {
		console.log('shutdown');
		connection.service = null;
	});

	connection.connection.listen();
});

process.on('uncaughtException', (err) => {
	console.error(err);
});
server.listen(2088, '127.0.0.1');