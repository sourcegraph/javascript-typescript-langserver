
import {TypeScriptService} from '../typescript-service';
import {FileSystem} from '../fs'
// import * as sinon from 'sinon';
import * as assert from 'assert';

// TODO use BDD style

describe('TypeScriptService', () => {

	let service: TypeScriptService;
	let fileSystem: FileSystem;

	beforeEach(async () => {
		fileSystem = new class TestFileSystem {
			private files = new Map<string, string>([
				['file:///a.ts', 'const abc = 1; console.log(abc);'],
				['file:///foo/b.ts', [
					'/* This is class Foo */',
					'export class Foo {}'
				].join('\n')],
				['file:///foo/c.ts', 'import {Foo} from "./b";'],
				['file:///d.ts', [
					'export interface I {',
					'target: string;',
					'}'
				].join('\n')],
				['file:///e.ts', [
					'import * as d from "./d";',
					'',
					'let i: d.I = { target: "hi" };',
					'let target = i.target;'
				].join('\n')],
			]);
			async getWorkspaceFiles(): Promise<string[]> {
				return Array.from(this.files.keys());
			}
			async getTextDocumentContent(uri: string): Promise<string> {
				return this.files.get(uri);
			}
		};

		service = new TypeScriptService();
		await service.initialize({
			processId: process.pid,
			rootPath: '/',
			capabilities: {}
		}, fileSystem, true);
	});

	afterEach(() => service.shutdown());

	describe('definition', () => {
		specify.only('in same file', async () => {
			const result = await service.getDefinition({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 29
				}
			});
			assert.deepEqual(result, [{
				uri: 'file:///a.ts',
				range: {
					start: {
						line: 0,
						character: 6
					},
					end: {
						line: 0,
						character: 13
					}
				}
			}]);
		});
		specify('on keyword (non-null)', async () => {
			const result = await service.getDefinition({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 0
				}
			});
			assert.deepEqual(result, []);
		});
		specify('definition in other file', async () => {
			const result = await service.getDefinition({
				textDocument: {
					uri: 'file:///foo/c.ts'
				},
				position: {
					line: 0,
					character: 9
				}
			});
			assert.deepEqual(result, {
				uri: 'file:///foo/b.ts',
				range: {
					start: {
						line: 1,
						character: 0
					},
					end: {
						line: 1,
						character: 19
					}
				}
			});
		});
	});
	describe('xdefinition', () => {
		specify('on interface field reference', async () => {
			const result = await service.getXdefinition({
				textDocument: {
					uri: 'file:///e.ts'
				},
				position: {
					line: 3,
					character: 15
				}
			});
			assert.deepEqual(result, {
				location: {
					uri: 'file:///d.ts',
					range: {
						start: {
							line: 1,
							character: 2
						},
						end: {
							line: 1,
							character: 17
						}
					}
				},
				symbol: {
					containerName: 'I',
					containerKind: '',
					kind: 'property',
					name: 'target',
				},
			});
		});
		specify('in same file', async () => {
			const result = await service.getXdefinition({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 29
				}
			});
			assert.deepEqual(result, {
				location: {
					uri: 'file:///a.ts',
					range: {
						start: {
							line: 0,
							character: 6
						},
						end: {
							line: 0,
							character: 13
						}
					}
				},
				symbol: {
					containerName: '',
					containerKind: '',
					kind: 'const',
					name: 'abc',
				}
			});
		});
	});
	describe('hover', () => {
		specify('in same file', async () => {
			const result = await service.getHover({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 29
				}
			});
			assert.deepEqual(result, {
				contents: [{
					language: 'typescript',
					value: 'const abc: 1'
				}]
			});
		});
		specify('hover in other file', async () => {
			const result = await service.getHover({
				textDocument: {
					uri: 'file:///foo/c.ts'
				},
				position: {
					line: 0,
					character: 9
				}
			});
			assert.deepEqual(result, {
				contents: [{
					language: 'typescript',
					value: 'import Foo'
				}]
			});
		});
		specify('hover over keyword (non-null)', async () => {
			const result = await service.getHover({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 0
				}
			});
			assert.deepEqual(result, {
				contents: []
			});
		});
		specify('hover over non-existent file', async () => {
			const result = await service.getHover({
				textDocument: {
					uri: 'file:///foo/a.ts'
				},
				position: {
					line: 0,
					character: 0
				}
			});
			// TODO should throw an exception instead
			assert.deepEqual(result, {
				contents: []
			});
		});
	});
});
