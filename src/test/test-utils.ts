import * as net from 'net';
import * as os from 'os';
import * as fs from 'fs';

import * as mocha from 'mocha';
import * as chai from 'chai';

import * as vscode from 'vscode-languageserver';

import { newConnectionWithLangHandler } from '../connection';
import { TypeScriptService } from '../typescript-service';
import { FileInfo } from '../fs';
import * as rt from '../request-type';
import * as util from '../util';
import { IConnection } from 'vscode-languageserver';

class Channel {
	server: net.Server;
	serverIn: net.Socket;
	serverOut: net.Socket;
	serverConnection: IConnection;

	client: net.Server;
	clientIn: net.Socket;
	clientOut: net.Socket;
	clientConnection: IConnection;
}

let channel: Channel;

export function setUp(memfs: any, done: (err?: Error) => void) {

	channel = new Channel();

	let counter = 2;

	function maybeDone() {
		counter--;
		if (counter === 0) {
			channel.serverConnection.listen();
			channel.clientConnection.listen();

			const params: vscode.InitializeParams = {
				processId: null,
				rootPath: 'file:///',
				capabilities: null
			}

			channel.clientConnection.sendRequest(rt.InitializeRequest.type, params).then(() => {
				done();
			}, (e) => {
				console.error(e);
				return done(new Error('initialization failed'));
			});
		}
	}

	channel.server = net.createServer((stream) => {
		channel.serverIn = stream;
		channel.serverConnection = newConnectionWithLangHandler(channel.serverIn, channel.serverOut, true, new TypeScriptService());
		maybeDone();
	});
	channel.client = net.createServer((stream) => {
		channel.clientIn = stream;
		channel.clientConnection = newConnectionWithLangHandler(channel.clientIn, channel.clientOut, true, new TypeScriptService());
		initFs(channel.clientConnection, memfs);
		maybeDone();
	});
	channel.server.listen(0, () => {
		channel.client.listen(0, () => {
			channel.clientOut = net.connect(channel.server.address().port);
			channel.serverOut = net.connect(channel.client.address().port);
		});
	});
}

function initFs(connection: IConnection, memfs: any) {
	connection.onRequest(rt.ReadDirRequest.type, (params: string): FileInfo[] => {
		params = params.substring(1);
		const path = params.length ? params.split('/') : [];
		let node = memfs;
		let i = 0;
		while (i < path.length) {
			node = node[path[i]];
			if (!node || typeof node != 'object') {
				throw new Error('no such file: ' + params);
			}
			i++;
		}
		const keys = Object.keys(node);
		let result = []
		keys.forEach((k) => {
			const v = node[k];
			if (typeof v == 'string') {
				result.push({
					name: k,
					size: v.length,
					dir: false
				})
			} else {
				result.push({
					name: k,
					size: 0,
					dir: true
				});
			}
		});
		return result;
	});

	connection.onRequest(rt.ReadFileRequest.type, (params: string): string => {
		params = params.substring(1);
		const path = params.length ? params.split('/') : [];
		let node = memfs;
		let i = 0;
		while (i < path.length - 1) {
			node = node[path[i]];
			if (!node || typeof node != 'object') {
				throw new Error('no such file: ' + params);
			}
			i++;
		}
		const content = node[path[path.length - 1]];
		if (!content || typeof content != 'string') {
			throw new Error('no such file');
		}
		return new Buffer(content).toString('base64');
	});
}

export function tearDown(done: () => void) {
	channel.client.close();
	channel.server.close();
	done();
}

function check(done: (err?: Error) => void, conditions: () => void) {
	try {
		conditions();
		done();
	} catch (err) {
		done(err);
	}
}

export function definition(pos: vscode.TextDocumentPositionParams, expected: vscode.Location | vscode.Location[], done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.DefinitionRequest.type, {
		textDocument: {
			uri: pos.textDocument.uri
		},
		position: {
			line: pos.position.line,
			character: pos.position.character
		}
	}).then((results: vscode.Location[]) => {
		expected = expected ? Array.isArray(expected) ? expected : [expected] : null;
		check(done, () => {
			chai.expect(results).to.deep.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('definition request failed'))
	})
}

export function hover(pos: vscode.TextDocumentPositionParams, expected: vscode.Hover, done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.HoverRequest.type, {
		textDocument: {
			uri: pos.textDocument.uri
		},
		position: {
			line: pos.position.line,
			character: pos.position.character
		}
	}).then((result: vscode.Hover) => {
		check(done, () => {
			chai.expect(result.contents).to.deep.equal(expected.contents);
		});
	}, (err?: Error) => {
		return done(err || new Error('hover request failed'))
	})
}

export function references(pos: vscode.TextDocumentPositionParams, expected: number, done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.ReferencesRequest.type, {
		textDocument: {
			uri: pos.textDocument.uri
		},
		position: {
			line: pos.position.line,
			character: pos.position.character
		}
	}).then((result: vscode.Location[]) => {
		check(done, () => {
			chai.expect(result.length).to.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('references request failed'))
	})
}

export function workspaceReferences(params: rt.WorkspaceReferenceParams, expected: rt.ReferenceInformation[], done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.WorkspaceReferenceRequest.type, params).then((result: rt.ReferenceInformation[]) => {
		check(done, () => {
			chai.expect(result).to.deep.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('references request failed'))
	})
}

export function symbols(params: rt.WorkspaceSymbolParamsWithLimit, expected: vscode.SymbolInformation[], done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.WorkspaceSymbolsRequest.type, params).then((result: vscode.SymbolInformation[]) => {
		check(done, () => {
			chai.expect(result).to.deep.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('workspace/symbol request failed'))
	})
}

export function documentSymbols(params: vscode.DocumentSymbolParams, expected: vscode.SymbolInformation[], done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.DocumentSymbolRequest.type, params).then((result: vscode.SymbolInformation[]) => {
		check(done, () => {
			chai.expect(result).to.deep.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('textDocument/documentSymbol request failed'))
	})
}

export function open(uri: string, text: string) {
	channel.clientConnection.sendNotification(rt.TextDocumentDidOpenNotification.type, {
		textDocument: {
			uri: uri,
			text: text
		}
	});
}

export function close(uri: string) {
	channel.clientConnection.sendNotification(rt.TextDocumentDidCloseNotification.type, {
		textDocument: {
			uri: uri
		}
	});
}

export function change(uri: string, text: string) {
	channel.clientConnection.sendNotification(rt.TextDocumentDidChangeNotification.type, {
		textDocument: {
			uri: uri
		}, contentChanges: [{
			text: text
		}]
	});
}
