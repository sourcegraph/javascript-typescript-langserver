/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');
var path = require('path');
var os = require('os');

var program = require('commander');

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

import {serve} from './processor';

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
				if (exported) {
					let res = exported.map(ent => {
						return SymbolInformation.create(ent.name, ent.kind, ent.location.range,
							'file:///' + ent.location.file, util.formExternalUri(ent));
					});
					return res;
				}
			} else if (params.query == "externals") {
				const externals = connection.service.getExternalRefs();
				if (externals) {
					let res = externals.map(external => {
						return SymbolInformation.create(external.name, util.formEmptyKind(), external.location.range,
							'file:///' + external.location.file, util.formExternalUri(external));
					});
					return res;
				}
			} else if (params.query == '') {
				const topDecls = connection.service.getTopLevelDeclarations();
				if (topDecls) {
					let res = topDecls.map(decl => {
						return SymbolInformation.create(decl.name, decl.kind, decl.location.range,
							'file:///' + decl.location.file, util.formExternalUri(decl));
					});
					return res;

				}
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
					if (def['url']) {
						//TODO process external doc ref here
						result.push(Location.create(def['url'], util.formEmptyRange()));
					} else {
						result.push(Location.create('file:///' + def.fileName, {
							start: connection.service.position(def.fileName, def.textSpan.start),
							end: connection.service.position(def.fileName, def.textSpan.start + def.textSpan.length)
						}));
					}
				}
			} else {
				//check whether definition is external, if uri string returned, add this location
				let externalDef = connection.service.getExternalDefinition(params.textDocument.uri, params.position.line, params.position.character);
				if (externalDef) {
					let fileName = externalDef.file;
					let res = Location.create(util.formExternalUri(externalDef),
						Range.create(this.getLineAndPosFromOffset(fileName, externalDef.start), this.getLineAndPosFromOffset(fileName, externalDef.start + externalDef.len)));
					result.push(res);
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

const defaultLspPort = 2088;
const defaultLpPort = 4145;

program
	.version('0.0.1')
	.option('-l, --lsp [port]', 'LSP port (' + defaultLspPort + ')', parseInt)
	.option('-p, --lp [port]', 'LP port (' + defaultLpPort + ')', parseInt)
	.option('-w, --workspace [directory]', 'Workspace directory')
	.parse(process.argv);

const lspPort = program.lsp || defaultLspPort;
const lpPort = program.lp || defaultLpPort;
const workspace = program.workspace ||
	path.join(process.env.SGPATH || path.join(os.homedir(), '.sourcegraph'),
		'workspace',
		'js');

console.log('Using workspace', workspace);
console.log('Listening for incoming LSP connections on', lspPort, 'and incoming LP connections on', lpPort);

server.listen(lspPort);
serve(lpPort, workspace);
