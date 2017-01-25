import * as net from 'net';
import * as chai from 'chai';
import * as vscode from 'vscode-languageserver';
import * as async from 'async';

import { newConnection, registerLanguageHandler } from '../connection';
import { LanguageHandler } from '../lang-handler';
import { FileInfo, FileSystem, MemoryFileSystemNode, MemoryFileSystem } from '../fs';
import * as rt from '../request-type';
import { IConnection } from 'vscode-languageserver';
import { path2uri } from '../util';

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

export function setUp(langhandler: LanguageHandler, fs: FileSystem | MemoryFileSystemNode, done: (err?: Error) => void) {
	if (channel) {
		throw new Error("channel wasn't torn down properly after previous test suite");
	}
	channel = new Channel();

	let counter = 2;

	function maybeDone() {
		counter--;
		if (counter === 0) {
			channel.serverConnection.listen();
			channel.clientConnection.listen();

			const params: vscode.InitializeParams = {
				processId: 99, // dummy value
				rootPath: 'file:///',
				capabilities: {},
			}

			channel.clientConnection.sendRequest(rt.InitializeRequest.type, params).then(() => {
				done();
			}, (e: any) => {
				console.error(e);
				return done(new Error('initialization failed'));
			});
		}
	}

	channel.server = net.createServer((stream) => {
		channel.serverIn = stream;
		channel.serverConnection = newConnection(channel.serverIn, channel.serverOut, { trace: true });
		registerLanguageHandler(channel.serverConnection, true, langhandler);
		maybeDone();
	});
	channel.client = net.createServer((stream) => {
		channel.clientIn = stream;
		channel.clientConnection = newConnection(channel.clientIn, channel.clientOut, { trace: false });
		const fs_ = (fs as FileSystem).readDir ? fs as FileSystem : new MemoryFileSystem(fs as MemoryFileSystemNode);
		initFs(channel.clientConnection, fs_);
		maybeDone();
	});
	channel.server.listen(0, () => {
		channel.client.listen(0, () => {
			channel.clientOut = net.connect(channel.server.address().port);
			channel.serverOut = net.connect(channel.client.address().port);
		});
	});
}

function initFs(connection: IConnection, fs: FileSystem) {
	connection.onRequest(rt.ReadDirRequest.type, (params: string): Promise<FileInfo[]> => {
		return new Promise<FileInfo[]>((resolve, reject) => {
			fs.readDir(params, (err: Error, result?: FileInfo[]) => {
				if (err) {
					return reject(err);
				}
				return resolve(result);
			});
		});
	});

	connection.onRequest(rt.ReadFileRequest.type, (params: string): Promise<string> => {
		return new Promise<string>((resolve, reject) => {
			fs.readFile(params, (err: Error, result?: string) => {
				if (err) {
					return reject(err);
				}
				return resolve(new Buffer(result).toString('base64'));
			});
		});
	});
}

export function tearDown(done: () => void) {
	channel.clientConnection.sendRequest(rt.ShutdownRequest.type).then(() => {
		channel.clientConnection.sendNotification(rt.ExitRequest.type);
		channel.client.close();
		channel.server.close();
		channel = undefined;
		done();
	}, (e: any) => {
		console.error("error on tearDown:", e);
	});
}

function check(done: (err?: Error) => void, conditions: () => void) {
	try {
		conditions();
		done();
	} catch (err) {
		done(err);
	}
}

export function definition(pos: vscode.TextDocumentPositionParams, expected: vscode.Location | vscode.Location[] | null, done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.DefinitionRequest.type, {
		textDocument: {
			uri: pos.textDocument.uri
		},
		position: {
			line: pos.position.line,
			character: pos.position.character
		}
	}).then((results: vscode.Location[]) => {
		expected = expected ? (Array.isArray(expected) ? expected : [expected]) : null;
		check(done, () => {
			chai.expect(results).to.deep.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('definition request failed'))
	})
}

export function xdefinition(pos: vscode.TextDocumentPositionParams, expected: rt.SymbolLocationInformation | rt.SymbolLocationInformation[] | null, done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.XdefinitionRequest.type, {
		textDocument: {
			uri: pos.textDocument.uri
		},
		position: {
			line: pos.position.line,
			character: pos.position.character
		}
	}).then((results: rt.SymbolLocationInformation[]) => {
		expected = expected ? (Array.isArray(expected) ? expected : [expected]) : null;
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

export function references(params: vscode.ReferenceParams, expected: number, done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.ReferencesRequest.type, params).then((result: vscode.Location[]) => {
		check(done, () => {
			chai.expect(result.length).to.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('textDocument/references request failed'))
	})
}

export function workspaceReferences(params: rt.WorkspaceReferenceParams, expected: rt.ReferenceInformation[], done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.WorkspaceReferenceRequest.type, params).then((result: rt.ReferenceInformation[]) => {
		check(done, () => {
			chai.expect(result).to.deep.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('workspace/xreferences request failed'))
	})
}

export function packages(expected: rt.PackageInformation[], done: (err?: Error) => void) {
	const cmp = (a: rt.PackageInformation, b: rt.PackageInformation) => a.package.name.localeCompare(b.package.name);
	channel.clientConnection.sendRequest(rt.PackagesRequest.type).then((result: rt.PackageInformation[]) => {
		check(done, () => {
			chai.expect(result.sort(cmp)).to.deep.equal(expected.sort(cmp));
		});
	}, (err?: Error) => {
		return done(err || new Error('packages request failed'))
	})
}

export function dependencies(expected: rt.DependencyReference[], done: (err?: Error) => void) {
	channel.clientConnection.sendRequest(rt.DependenciesRequest.type).then((result: rt.DependencyReference[]) => {
		check(done, () => {
			chai.expect(result).to.deep.equal(expected);
		});
	}, (err?: Error) => {
		return done(err || new Error('dependencies request failed'))
	})
}

export function symbols(params: rt.WorkspaceSymbolParams, expected: vscode.SymbolInformation[], done: (err?: Error) => void) {
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
			languageId: "",
			version: 0,
			text: text
		}
	});
}

export function close(uri: string) {
	channel.clientConnection.sendNotification(rt.TextDocumentDidCloseNotification.type, {
		textDocument: {
			uri: uri,
		}
	});
}

export function change(uri: string, text: string) {
	channel.clientConnection.sendNotification(rt.TextDocumentDidChangeNotification.type, {
		textDocument: {
			uri: uri,
			version: 0,
		}, contentChanges: [{
			text: text
		}]
	});
}

export function completions(params: vscode.TextDocumentPositionParams, expected: vscode.CompletionItem[], done: (err?: Error) => void) {
	const cmp = (a: vscode.CompletionItem, b: vscode.CompletionItem) => a.label.localeCompare(b.label);
	channel.clientConnection.sendRequest(rt.TextDocumentCompletionRequest.type, params).then((result: vscode.CompletionList) => {
		check(done, () => {
			chai.assert(result);
			result.items.sort(cmp);
			chai.expect(result.items).to.deep.equal(expected.sort(cmp));
		});
	}, (err?: Error) => {
		return done(err || new Error('textDocument/completion request failed'))
	})
}

export interface TestDescriptor {
	definitions?: { [position: string]: string | string[] };
	hovers?: { [position: string]: vscode.Hover };
	references?: { [position: string]: number };
	workspaceReferences?: [{ params: rt.WorkspaceReferenceParams, expected: rt.ReferenceInformation[] }];
	packages?: rt.PackageInformation[];
	dependencies?: rt.DependencyReference[];
	symbols?: [{ params: rt.WorkspaceSymbolParams, expected: vscode.SymbolInformation[] }];
	documentSymbols?: { [uri: string]: vscode.SymbolInformation[] };
	completions?: { [position: string]: vscode.CompletionItem[] };
	xdefinitions?: { [position: string]: rt.SymbolLocationInformation | rt.SymbolLocationInformation[] }
}

export function position(pos: string): vscode.TextDocumentPositionParams {
	const parts = pos.split(':', 3);
	return {
		textDocument: {
			uri: path2uri('', parts[0])
		},
		position: {
			line: parseInt(parts[1]),
			character: parseInt(parts[2])
		}
	};
}

export function location(s: string | string[]): vscode.Location[] {
	if (!Array.isArray(s)) {
		s = [s];
	}
	const ret: vscode.Location[] = [];
	s.forEach(item => {
		const parts = item.split(':', 5);
		ret.push({
			uri: path2uri('', '/' + parts[0]),
			range: {
				start: {
					line: parseInt(parts[1]),
					character: parseInt(parts[2])
				},
				end: {
					line: parseInt(parts[3]),
					character: parseInt(parts[4])
				}
			}
		});
	});
	return ret;
}

export function reference(pos: string): vscode.ReferenceParams {
	const parts = pos.split(':', 3);
	return {
		textDocument: {
			uri: path2uri('', parts[0])
		},
		position: {
			line: parseInt(parts[1]),
			character: parseInt(parts[2])
		},
		context: {
			includeDeclaration: false
		}
	};
}

function testHover(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.hovers) {
			return done();
		}
		const tasks = [];
		for (const pos in descriptor.hovers) {
			tasks.push((callback: (err?: Error) => void) => {
				hover(position(pos), descriptor.hovers[pos], callback);
			});
		}
		async.parallel(tasks, done);
	}
}

function testDefinition(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.definitions) {
			return done();
		}
		const tasks = [];
		for (const pos in descriptor.definitions) {
			tasks.push((callback: (err?: Error) => void) => {
				definition(position(pos), location(descriptor.definitions[pos]), callback);
			});
		}
		async.parallel(tasks, done);
	}
}

function testReferences(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.references) {
			return done();
		}
		const tasks = [];
		for (const pos in descriptor.references) {
			tasks.push((callback: (err?: Error) => void) => {
				references(reference(pos), descriptor.references[pos], callback);
			});
		}
		async.parallel(tasks, done);
	}
}

function testXDefinition(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.xdefinitions) {
			return done();
		}
		const tasks = [];
		for (const pos in descriptor.xdefinitions) {
			tasks.push((callback: (err?: Error) => void) => {
				xdefinition(position(pos), descriptor.xdefinitions[pos], callback);
			});
		}
		async.parallel(tasks, done);
	}
}

function testPackages(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.packages) {
			return done();
		}
		packages(descriptor.packages, done);
	}
}

function testWorkspaceReferences(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.workspaceReferences) {
			return done();
		}
		const tasks = [];
		for (const i in descriptor.workspaceReferences) {
			tasks.push((callback: (err?: Error) => void) => {
				workspaceReferences(descriptor.workspaceReferences[i].params, descriptor.workspaceReferences[i].expected, callback);
			});
		}
		async.parallel(tasks, done);
	}
}

function testDependencies(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.dependencies) {
			return done();
		}
		dependencies(descriptor.dependencies, done);
	}
}

function testSymbols(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.symbols) {
			return done();
		}
		const tasks = [];
		for (const i in descriptor.symbols) {
			tasks.push((callback: (err?: Error) => void) => {
				symbols(descriptor.symbols[i].params, descriptor.symbols[i].expected, callback);
			});
		}
		async.parallel(tasks, done);
	}
}

function testDocumentSymbols(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.documentSymbols) {
			return done();
		}
		const tasks = [];
		for (const p in descriptor.documentSymbols) {
			tasks.push((callback: (err?: Error) => void) => {
				documentSymbols({ textDocument: { uri: path2uri('', p) } }, descriptor.documentSymbols[p], callback);
			});
		}
		async.parallel(tasks, done);
	}
}

function testCompletions(descriptor: TestDescriptor): (done: (err?: Error) => void) => void {
	return (done: (err?: Error) => void) => {
		if (!descriptor.completions) {
			return done();
		}
		const tasks = [];
		for (const p in descriptor.completions) {
			tasks.push((callback: (err?: Error) => void) => {
				completions(position(p), descriptor.completions[p], callback);
			});
		}
		async.parallel(tasks, done);
	}
}

export function tests(descriptor: TestDescriptor) {
	it('hover', testHover(descriptor));
	it('definition', testDefinition(descriptor));
	it('references', testReferences(descriptor));
	it('xdefinition', testXDefinition(descriptor));
	it('packages', testPackages(descriptor));
	it('workspaceReferences', testWorkspaceReferences(descriptor));
	it('dependencies', testDependencies(descriptor));
	it('symbols', testSymbols(descriptor));
	it('documentSymbols', testDocumentSymbols(descriptor));
	it('completions', testCompletions(descriptor));
}