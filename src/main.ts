/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');

import * as ts from 'typescript';
import * as util from './util';

import {
	InitializeParams, InitializeResult,
	TextDocuments,
	TextDocumentPositionParams, Definition, ReferenceParams, Location, Hover
} from 'vscode-languageserver';

import TypeScriptService from './typescript';
import Connection from './connection';

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

	connection.connection.onDefinition((params: TextDocumentPositionParams): Definition => {
		try {
			console.log('definition', params.textDocument.uri, params.position.line, params.position.character)
			const defs: ts.DefinitionInfo[] = connection.service.getDefinition(params.textDocument.uri, params.position.line, params.position.character)
			let result: Location[] = [];
			if (defs) {
				for (let def of defs) {
					result.push(Location.create('file:///' + def.fileName, {
						start: connection.service.position(def.fileName, def.textSpan.start),
						end: connection.service.position(def.fileName, def.textSpan.start + def.textSpan.length)
					}));
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
			console.log('refernces', params.textDocument.uri, params.position.line, params.position.character);
			const refSymbols: ts.ReferencedSymbol[] = connection.service.getReferences(params.textDocument.uri, params.position.line, params.position.character);
			const result: Location[] = [];
			//TODO for now we take first refernce symbol, check when more than one returned and extend
			if (refSymbols) {
				for (let refSymbol of refSymbols.slice(0, 1)) {
					//first pushes declaration
					result.push(Location.create('file:///' + refSymbol.definition.fileName, {
						start: connection.service.position(refSymbol.definition.fileName, refSymbol.definition.textSpan.start),
						end: connection.service.position(refSymbol.definition.fileName, refSymbol.definition.textSpan.start + refSymbol.definition.textSpan.length)
					}));

					//then pushes references
					for (let ref of refSymbol.references) {
						result.push(Location.create('file:///' + ref.fileName, {
							start: connection.service.position(ref.fileName, ref.textSpan.start),
							end: connection.service.position(ref.fileName, ref.textSpan.start + ref.textSpan.length)
						}));
					}
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