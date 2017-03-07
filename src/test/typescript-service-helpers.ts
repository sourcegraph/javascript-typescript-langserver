import * as ts from 'typescript';
import {TypeScriptService} from '../typescript-service';
import {FileSystem} from '../fs'
import {CompletionItemKind} from 'vscode-languageserver';
// import * as sinon from 'sinon';
import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;

export class TestFileSystem {
	constructor(private files: Map<string, string>) {}
	async getWorkspaceFiles(): Promise<string[]> {
		return Array.from(this.files.keys());
	}
	async getTextDocumentContent(uri: string): Promise<string> {
		if (!this.files.has(uri)) {
			throw new Error(`Unknown file ${uri}`);
		}
		return this.files.get(uri);
	}
}

export interface TestContext {
	service: TypeScriptService;
}

export const initializeTypeScriptService = (fileSystem: FileSystem) => async function (this: TestContext): Promise<void> {
	await this.service.initialize({
		processId: process.pid,
		rootPath: '/',
		capabilities: {}
	}, fileSystem, true);
}

export function describeTypeScriptService() {

	afterEach('Shutdown TypeScriptService', <any>function (this: TestContext) {
		return this.service.shutdown();
	});

	describe('Workspace without project files', <any>function (this: TestContext) {

		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///a.ts', 'const abc = 1; console.log(abc);'],
			['file:///foo/b.ts', [
				'/* This is class Foo */',
				'export class Foo {}'
			].join('\n')],
			['file:///foo/c.ts', 'import {Foo} from "./b";'],
			['file:///d.ts', [
				'export interface I {',
				'  target: string;',
				'}'
			].join('\n')],
			['file:///e.ts', [
				'import * as d from "./d";',
				'',
				'let i: d.I = { target: "hi" };',
				'let target = i.target;'
			].join('\n')],
		]))));

		describe('getDefinition()', <any>function (this: TestContext) {
			specify('in same file', <any>async function (this: TestContext) {
				const result = await this.service.getDefinition({
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
			specify('on keyword (non-null)', <any>async function (this: TestContext) {
				const result = await this.service.getDefinition({
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
			specify('in other file', <any>async function (this: TestContext) {
				const result = await this.service.getDefinition({
					textDocument: {
						uri: 'file:///foo/c.ts'
					},
					position: {
						line: 0,
						character: 9
					}
				});
				assert.deepEqual(result, [{
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
				}]);
			});
		});
		describe('getXdefinition()', <any>function (this: TestContext) {
			specify('on interface field reference', <any>async function (this: TestContext) {
				const result = await this.service.getXdefinition({
					textDocument: {
						uri: 'file:///e.ts'
					},
					position: {
						line: 3,
						character: 15
					}
				});
				assert.deepEqual(result, [{
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
				}]);
			});
			specify('in same file', <any>async function (this: TestContext) {
				const result = await this.service.getXdefinition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				});
				assert.deepEqual(result, [{
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
				}]);
			});
		});
		describe('getHover()', <any>function (this: TestContext) {
			specify('in same file', <any>async function (this: TestContext) {
				const result = await this.service.getHover({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				});
				assert.deepEqual(result, {
					range: {
						start: {
							line: 0,
							character: 27
						},
						end: {
							line: 0,
							character: 30
						}
					},
					contents: [{
						language: 'typescript',
						value: 'const abc: 1'
					}]
				});
			});
			specify('in other file', <any>async function (this: TestContext) {
				const result = await this.service.getHover({
					textDocument: {
						uri: 'file:///foo/c.ts'
					},
					position: {
						line: 0,
						character: 9
					}
				});
				assert.deepEqual(result, {
					range: {
						end: {
							line: 0,
							character: 11
						},
						start: {
							line: 0,
							character: 8
						}
					},
					contents: [{
						language: 'typescript',
						value: 'import Foo'
					}]
				});
			});
			specify('over keyword (non-null)', <any>async function (this: TestContext) {
				const result = await this.service.getHover({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				});
				assert.deepEqual(result, { contents: [] });
			});
			specify('over non-existent file', <any>function (this: TestContext) {
				return assert.isRejected(this.service.getHover({
					textDocument: {
						uri: 'file:///foo/a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				}));
			});
		});
	});

	describe('Workspace with typings directory', <any>function (this: TestContext) {

		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///a.ts', "import * as m from 'dep';"],
			['file:///typings/dep.d.ts', "declare module 'dep' {}"],
			['file:///src/tsconfig.json', [
				'{',
				'  "compilerOptions": {',
				'    "target": "ES5",',
				'    "module": "commonjs",',
				'    "sourceMap": true,',
				'    "noImplicitAny": false,',
				'    "removeComments": false,',
				'    "preserveConstEnums": true',
				'  }',
				'}',
			].join('\n')],
			['file:///src/tsd.d.ts', '/// <reference path="../typings/dep.d.ts" />'],
			['file:///src/dir/index.ts', 'import * as m from "dep";']
		]))));

		describe('getDefinition()', <any>function (this: TestContext) {
			specify('with tsd.d.ts', <any>async function (this: TestContext) {
				const result = await this.service.getDefinition({
					textDocument: {
						uri: 'file:///src/dir/index.ts'
					},
					position: {
						line: 0,
						character: 20
					}
				});
				assert.deepEqual(result, [{
					uri: 'file:///typings/dep.d.ts',
					range: {
						start: {
							line: 0,
							character: 0
						},
						end: {
							line: 0,
							character: 23
						}
					}
				}]);
			});
			describe('on file in project root', <any>function (this: TestContext) {
				specify('on import alias', <any>async function (this: TestContext) {
					const result = await this.service.getDefinition({
						textDocument: {
							uri: 'file:///a.ts'
						},
						position: {
							line: 0,
							character: 12
						}
					});
					assert.deepEqual(result, [{
						uri: 'file:///typings/dep.d.ts',
						range: {
							start: {
								line: 0,
								character: 0
							},
							end: {
								line: 0,
								character: 23
							}
						}
					}]);
				});
				specify('on module name', <any>async function (this: TestContext) {
					const result = await this.service.getDefinition({
						textDocument: {
							uri: 'file:///a.ts'
						},
						position: {
							line: 0,
							character: 20
						}
					});
					assert.deepEqual(result, [{
						uri: 'file:///typings/dep.d.ts',
						range: {
							start: {
								line: 0,
								character: 0
							},
							end: {
								line: 0,
								character: 23
							}
						}
					}]);
				});
			});
		});
	});

	describe('Global module', <any>function (this: TestContext) {

		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///a.ts', "const rt: GQL.Rt;"],
			['file:///interfaces.d.ts', 'declare namespace GQL { interface Rt { } }']
		]))));

		specify('getDefinition()', <any>async function (this: TestContext) {
			const result = await this.service.getDefinition({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 14
				}
			})
			assert.deepEqual(result, [{
				uri: 'file:///interfaces.d.ts',
				range: {
					start: {
						line: 0,
						character: 24
					},
					end: {
						line: 0,
						character: 40
					}
				}
			}]);
		});
	});

	describe('DefinitelyTyped', <any>function (this: TestContext) {
		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///package.json', JSON.stringify({
				"private": true,
				"name": "definitely-typed",
				"version": "0.0.1",
				"homepage": "https://github.com/DefinitelyTyped/DefinitelyTyped",
				"repository": {
					"type": "git",
					"url": "git+https://github.com/DefinitelyTyped/DefinitelyTyped.git"
				},
				"license": "MIT",
				"bugs": {
					"url": "https://github.com/DefinitelyTyped/DefinitelyTyped/issues"
				},
				"engines": {
					"node": ">= 6.9.1"
				},
				"scripts": {
					"compile-scripts": "tsc -p scripts",
					"new-package": "node scripts/new-package.js",
					"not-needed": "node scripts/not-needed.js",
					"lint": "node scripts/lint.js",
					"test": "node node_modules/types-publisher/bin/tester/test.js --run-from-definitely-typed --nProcesses 1"
				},
				"devDependencies": {
					"types-publisher": "Microsoft/types-publisher#production"
				}
			}, null, 4)],
			['file:///resolve/index.d.ts', [
				'/// <reference types="node" />',
				'',
				'type resolveCallback = (err: Error, resolved?: string) => void;',
				'declare function resolve(id: string, cb: resolveCallback): void;',
				''
			].join('\n')],
			['file:///resolve/tsconfig.json', [
				'{',
				'	"compilerOptions": {',
				'		"module": "commonjs",',
				'		"lib": [',
				'			"es6"',
				'		],',
				'		"noImplicitAny": true,',
				'		"noImplicitThis": true,',
				'		"strictNullChecks": false,',
				'		"baseUrl": "../",',
				'		"typeRoots": [',
				'			"../"',
				'		],',
				'		"types": [],',
				'		"noEmit": true,',
				'		"forceConsistentCasingInFileNames": true',
				'	},',
				'	"files": [',
				'		"index.d.ts"',
				'	]',
				'}'
			].join('\n')],
			['file:///notResolve/index.d.ts', [
				'/// <reference types="node" />',
				'',
				'type resolveCallback = (err: Error, resolved?: string) => void;',
				'declare function resolve(id: string, cb: resolveCallback): void;',
				''
			].join('\n')],
			['file:///notResolve/tsconfig.json', [
				'{',
				'	"compilerOptions": {',
				'		"module": "commonjs",',
				'		"lib": [',
				'			"es6"',
				'		],',
				'		"noImplicitAny": true,',
				'		"noImplicitThis": true,',
				'		"strictNullChecks": false,',
				'		"baseUrl": "../",',
				'		"typeRoots": [',
				'			"../"',
				'		],',
				'		"types": [],',
				'		"noEmit": true,',
				'		"forceConsistentCasingInFileNames": true',
				'	},',
				'	"files": [',
				'		"index.d.ts"',
				'	]',
				'}'
			].join('\n')]
		]))));

		describe('getWorkspaceSymbols()', <any>function (this: TestContext) {
			specify('resolve, with package', <any>async function (this: TestContext) {
				const result = await this.service.getWorkspaceSymbols({
					symbol: { 'name': 'resolveCallback', 'package': { 'name': '@types/resolve' } },
					limit: 10,
				})
				assert.deepEqual(result, [{
					"kind": 15,
					"location": {
						"range": {
							"end": {
								"character": 63,
								"line": 2,
							},
							"start": {
								"character": 0,
								"line": 2,
							},
						},
						"uri": "file:///resolve/index.d.ts",
					},
					"name": "resolveCallback"
				}]);
			});
			specify('resolve, with package, empty containerKind', <any>async function (this: TestContext) {
				const result = await this.service.getWorkspaceSymbols({
					symbol: { 'name': 'resolveCallback', 'containerKind': '', 'package': { 'name': '@types/resolve' } },
					limit: 10,
				});
				assert.deepEqual(result, [{
					"kind": 15,
					"location": {
						"range": {
							"end": {
								"character": 63,
								"line": 2,
							},
							"start": {
								"character": 0,
								"line": 2,
							},
						},
						"uri": "file:///resolve/index.d.ts",
					},
					"name": "resolveCallback",
				}]);
			});
		});
	});

	describe('Workspace with root package.json', <any>function (this: TestContext) {

		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///a.ts', 'class a { foo() { const i = 1;} }'],
			['file:///foo/b.ts', "class b { bar: number; baz(): number { return this.bar;}}; function qux() {}"],
			['file:///c.ts', 'import { x } from "dep/dep";'],
			['file:///package.json', '{ "name": "mypkg" }'],
			['file:///node_modules/dep/dep.ts', 'export var x = 1;']
		]))));

		describe('getWorkspaceSymbols()', <any>function (this: TestContext) {
			describe('symbol query', <any>function (this: TestContext) {
				specify('with package', <any>async function (this: TestContext) {
					const result = await this.service.getWorkspaceSymbols({
						symbol: { name: 'a', kind: 'class', package: { name: 'mypkg' } },
						limit: 10,
					});
					assert.deepEqual(result, [{
						"kind": 5,
						"location": {
							"range": {
								"end": {
									"character": 33,
									"line": 0,
								},
								"start": {
									"character": 0,
									"line": 0,
								},
							},
							"uri": "file:///a.ts",
						},
						"name": "a",
					}]);
				});
				specify('with package, with package version (ignored)', <any>async function (this: TestContext) {
					const result = await this.service.getWorkspaceSymbols({
						symbol: { name: 'a', kind: 'class', package: { name: 'mypkg', version: "203940234" } },
						limit: 10,
					});
					assert.deepEqual(result, [{
						"kind": 5,
						"location": {
							"range": {
								"end": {
									"character": 33,
									"line": 0,
								},
								"start": {
									"character": 0,
									"line": 0,
								},
							},
							"uri": "file:///a.ts",
						},
						"name": "a",
					}]);
				});
				specify('for a', <any>async function (this: TestContext) {
					const result = await this.service.getWorkspaceSymbols({
						symbol: { 'name': 'a' },
						limit: 10,
					});
					assert.deepEqual(result, [{
						"kind": 5,
						"location": {
							"range": {
								"end": {
									"character": 33,
									"line": 0,
								},
								"start": {
									"character": 0,
									"line": 0,
								},
							},
							"uri": "file:///a.ts",
						},
						"name": "a",
					}]);
				});
			});
			describe('text query', <any>function (this: TestContext) {
				specify('for a', <any>async function (this: TestContext) {
					const result = await this.service.getWorkspaceSymbols({
						query: 'a',
						limit: 10,
					});
					assert.deepEqual(result, [{
						"kind": 5,
						"location": {
							"range": {
								"end": {
									"character": 33,
									"line": 0,
								},
								"start": {
									"character": 0,
									"line": 0,
								},
							},
							"uri": "file:///a.ts",
						},
						"name": "a",
					}]);
				});
				specify('with wrong package', <any>async function (this: TestContext) {
					const result = await this.service.getWorkspaceSymbols({
						symbol: { name: 'a', kind: 'class', package: { name: "not-mypkg" } },
						limit: 10,
					});
					assert.deepEqual(result, []);
				});
			});
		});

		describe('getWorkspaceReference()', <any>function (this: TestContext) {
			specify('"foo"', <any>async function (this: TestContext) {
				const result = await this.service.getWorkspaceReference({ query: { "name": "foo", "kind": "method", "containerName": "a" } });
				assert.deepEqual(result, [{
					"symbol": {
						"containerKind": "",
						"containerName": "a",
						"name": "foo",
						"kind": "method",
					},
					"reference": {
						"range": {
							"end": {
								"character": 13,
								"line": 0
							},
							"start": {
								"character": 9,
								"line": 0
							},
						},
						"uri": "file:///a.ts",
					},
				}]);
			});
			specify('"foo", with hint', <any>async function (this: TestContext) {
				const result = await this.service.getWorkspaceReference({ query: { "name": "foo", "kind": "method", "containerName": "a" }, hints: { dependeePackageName: "mypkg" } });
				assert.deepEqual(result, [{
					"symbol": {
						"containerKind": "",
						"containerName": "a",
						"name": "foo",
						"kind": "method",
					},
					"reference": {
						"range": {
							"end": {
								"character": 13,
								"line": 0
							},
							"start": {
								"character": 9,
								"line": 0
							},
						},
						"uri": "file:///a.ts",
					},
				}]);
			});
			specify('"foo", with hint, not found', <any>async function (this: TestContext) {
				const result = await this.service.getWorkspaceReference({ query: { "name": "foo", "kind": "method", "containerName": "a" }, hints: { dependeePackageName: "NOT-mypkg" } });
				assert.deepEqual(result, []);
			});
			specify('dependency reference', <any>async function (this: TestContext) {
				const result = await this.service.getWorkspaceReference({ query: { "name": "x", "containerName": "/node_modules/dep/dep" } });
				assert.deepEqual(result, [{
					"reference": {
						"range": {
							"end": {
								"character": 10,
								"line": 0,
							},
							"start": {
								"character": 8,
								"line": 0,
							}
						},
						"uri": "file:///c.ts",
					},
					"symbol": {
						"containerKind": "",
						"containerName": "/node_modules/dep/dep",
						"kind": "var",
						"name": "x",
					},
				}]);
			});
			specify('all references', <any>async function (this: TestContext) {
				const result = await this.service.getWorkspaceReference({ query: {} });
				assert.deepEqual(result, [
					{
						"symbol": {
							"containerName": "",
							"containerKind": "",
							"kind": "class",
							"name": "a",
						},
						"reference": {
							"range": {
								"end": {
									"character": 7,
									"line": 0
								},
								"start": {
									"character": 5,
									"line": 0
								},
							},
							"uri": "file:///a.ts",
						},
					},
					{
						"symbol": {
							"containerName": "a",
							"containerKind": "",
							"name": "foo",
							"kind": "method",
						},
						"reference": {
							"range": {
								"end": {
									"character": 13,
									"line": 0
								},
								"start": {
									"character": 9,
									"line": 0
								},
							},
							"uri": "file:///a.ts",
						},
					},
					{
						"symbol": {
							"containerName": "",
							"containerKind": "",
							"name": "i",
							"kind": "const",
						},
						"reference": {
							"range": {
								"end": {
									"character": 25,
									"line": 0
								},
								"start": {
									"character": 23,
									"line": 0
								},
							},
							"uri": "file:///a.ts",
						},
					},
					{
						"reference": {
							"range": {
								"end": {
									"character": 10,
									"line": 0,
								},
								"start": {
									"character": 8,
									"line": 0,
								}
							},
							"uri": "file:///c.ts",
						},
						"symbol": {
							"containerKind": "",
							"containerName": "/node_modules/dep/dep",
							"kind": "var",
							"name": "x",
						},
					},
					{
						"symbol": {
							"containerName": "",
							"containerKind": "",
							"name": "b",
							"kind": "class",
						},
						"reference": {
							"range": {
								"end": {
									"character": 7,
									"line": 0
								},
								"start": {
									"character": 5,
									"line": 0
								},
							},
							"uri": "file:///foo/b.ts",
						},
					},
					{
						"symbol": {
							"containerName": "b",
							"containerKind": "",
							"name": "bar",
							"kind": "property",
						},
						"reference": {
							"range": {
								"end": {
									"character": 13,
									"line": 0
								},
								"start": {
									"character": 9,
									"line": 0
								},
							},
							"uri": "file:///foo/b.ts",
						},
					},
					{
						"symbol": {
							"containerName": "b",
							"containerKind": "",
							"name": "baz",
							"kind": "method",
						},
						"reference": {
							"range": {
								"end": {
									"character": 26,
									"line": 0
								},
								"start": {
									"character": 22,
									"line": 0
								},
							},
							"uri": "file:///foo/b.ts",
						},
					},
					{
						"symbol": {
							"containerName": "b",
							"containerKind": "",
							"name": "bar",
							"kind": "property",
						},
						"reference": {
							"range": {
								"end": {
									"character": 54,
									"line": 0
								},
								"start": {
									"character": 51,
									"line": 0
								},
							},
							"uri": "file:///foo/b.ts",
						},
					},
					{
						"symbol": {
							"containerName": "",
							"containerKind": "",
							"name": "qux",
							"kind": "function",
						},
						"reference": {
							"range": {
								"end": {
									"character": 71,
									"line": 0
								},
								"start": {
									"character": 67,
									"line": 0
								},
							},
							"uri": "file:///foo/b.ts",
						},
					},
				]);
			});
		});
	});

	describe('Dependency detection', <any>function (this: TestContext) {

		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///package.json', JSON.stringify({
				"name": "tslint",
				"version": "4.0.2",
				"dependencies": {
					"babel-code-frame": "^6.16.0",
					"findup-sync": "~0.3.0"
				},
				"devDependencies": {
					"@types/babel-code-frame": "^6.16.0",
					"@types/optimist": "0.0.29",
					"chai": "^3.0.0",
					"tslint": "latest",
					"tslint-test-config-non-relative": "file:test/external/tslint-test-config-non-relative",
					"typescript": "2.0.10"
				},
				"peerDependencies": {
					"typescript": ">=2.0.0"
				}
			})],
			['file:///node_modules/dep/package.json', JSON.stringify({
				"name": "foo",
				"dependencies": {
					"shouldnotinclude": "0.0.0"
				}
			})],
			['file:///subproject/package.json', JSON.stringify({
				"name": "subproject",
				"repository": {
					"url": "https://github.com/my/subproject"
				},
				"dependencies": {
					"subproject-dep": "0.0.0"
				}
			})]
		]))));

		describe('getDependencies()', <any>function (this: TestContext) {
			it('should account for all dependencies', <any>async function (this: TestContext) {
				const result = await this.service.getDependencies();
				assert.deepEqual(result, [
					{ attributes: { 'name': 'babel-code-frame', 'version': '^6.16.0' }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': 'findup-sync', 'version': '~0.3.0' }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': "@types/babel-code-frame", 'version': "^6.16.0" }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': "@types/optimist", 'version': "0.0.29" }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': "chai", 'version': "^3.0.0" }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': "tslint", 'version': "latest" }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': "tslint-test-config-non-relative", 'version': "file:test/external/tslint-test-config-non-relative" }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': "typescript", 'version': "2.0.10" }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': "typescript", 'version': ">=2.0.0" }, hints: { 'dependeePackageName': 'tslint' } },
					{ attributes: { 'name': "subproject-dep", 'version': "0.0.0" }, hints: { 'dependeePackageName': 'subproject' } },
				]);
			});
		});
		describe('getPackages()', <any>function (this: TestContext) {
			it('should accournt for all packages', <any>async function (this: TestContext) {
				const result = await this.service.getPackages();
				assert.deepEqual(result, [{
					package: {
						name: 'tslint',
						version: '4.0.2',
						repoURL: undefined
					},
					dependencies: [
						{ attributes: { 'name': 'babel-code-frame', 'version': '^6.16.0' }, hints: { 'dependeePackageName': 'tslint' } },
						{ attributes: { 'name': 'findup-sync', 'version': '~0.3.0' }, hints: { 'dependeePackageName': 'tslint' } },
						{ attributes: { 'name': "@types/babel-code-frame", 'version': "^6.16.0" }, hints: { 'dependeePackageName': 'tslint' } },
						{ attributes: { 'name': "@types/optimist", 'version': "0.0.29" }, hints: { 'dependeePackageName': 'tslint' } },
						{ attributes: { 'name': "chai", 'version': "^3.0.0" }, hints: { 'dependeePackageName': 'tslint' } },
						{ attributes: { 'name': "tslint", 'version': "latest" }, hints: { 'dependeePackageName': 'tslint' } },
						{ attributes: { 'name': "tslint-test-config-non-relative", 'version': "file:test/external/tslint-test-config-non-relative" }, hints: { 'dependeePackageName': 'tslint' } },
						{ attributes: { 'name': "typescript", 'version': "2.0.10" }, hints: { 'dependeePackageName': 'tslint' } },
						{ attributes: { 'name': "typescript", 'version': ">=2.0.0" }, hints: { 'dependeePackageName': 'tslint' } },
					],
				}, {
					package: {
						name: 'subproject',
						version: undefined,
						repoURL: "https://github.com/my/subproject",
					},
					dependencies: [
						{ attributes: { 'name': "subproject-dep", 'version': "0.0.0" }, hints: { 'dependeePackageName': 'subproject' } },
					]
				}]);
			});
		})
	});

	describe('TypeScript library', function () {
		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///a.ts', "let parameters = [];"]
		]))));

		specify('type of parameters should be any[]', <any>async function (this: TestContext) {
			const result = await this.service.getHover({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 5
				}
			});
			assert.deepEqual(result, {
				range: {
			  	  	end: {
			  			character: 14,
			  			line: 0
			  	  	},
					start: {
						character: 4,
						line: 0
					}
			  	},
				contents: [{
					language: 'typescript',
					value: 'let parameters: any[]'
				}]
			});
		});
	});

	describe('Live updates', <any>function (this: TestContext) {

		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///a.ts', 'let parameters = [];']
		]))));

		specify('hover updates', <any>async function (this: TestContext) {

			const hoverParams = {
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 5
				}
			};

			const range = {
				end: {
					character: 14,
					line: 0
				},
				start: {
					character: 4,
					line: 0
				}
			};

			assert.deepEqual(await this.service.getHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: any[]'
				}]
			});

			await this.service.didOpen({
				textDocument: {
					uri: 'file:///a.ts',
					languageId: 'typescript',
					version: 1,
					text: 'let parameters: string[]'
				}
			});

			assert.deepEqual(await this.service.getHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: string[]'
				}]
			});

			await this.service.didChange({
				textDocument: {
					uri: 'file:///a.ts',
					version: 2
				},
				contentChanges: [{
					text: 'let parameters: number[]'
				}]
			});

			assert.deepEqual(await this.service.getHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: number[]'
				}]
			});

			await this.service.didClose({
				textDocument: {
					uri: 'file:///a.ts'
				}
			});

			assert.deepEqual(await this.service.getHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: any[]'
				}]
			});
		});
	});

	describe('References and imports', function () {
		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///a.ts', '/// <reference path="b.ts"/>\nnamespace qux {let f : foo;}'],
			['file:///b.ts', '/// <reference path="foo/c.ts"/>'],
			['file:///c.ts', 'import * as d from "./foo/d"\nd.bar()'],
			['file:///foo/c.ts', 'namespace qux {export interface foo {}}'],
			['file:///foo/d.ts', 'export function bar() {}'],
			['file:///deeprefs/a.ts', '/// <reference path="b.ts"/>\nnamespace qux {\nlet f : foo;\n}'],
			['file:///deeprefs/b.ts', '/// <reference path="c.ts"/>'],
			['file:///deeprefs/c.ts', '/// <reference path="d.ts"/>'],
			['file:///deeprefs/d.ts', '/// <reference path="e.ts"/>'],
			['file:///deeprefs/e.ts', 'namespace qux {\nexport interface foo {}\n}'],
			['file:///missing/a.ts', '/// <reference path="b.ts"/>\n/// <reference path="missing.ts"/>\nnamespace t {\n    function foo() : Bar {\n        return null;\n    }\n}'],
			['file:///missing/b.ts', 'namespace t {\n    export interface Bar {\n        id?: number;\n    }}']
		]))));
		describe('getDefinition()', <any>function (this: TestContext) {
			it('should resolve symbol imported with tripe-slash reference', <any>async function (this: TestContext) {
				const result = await this.service.getDefinition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 1,
						character: 23
					}
				});
				assert.deepEqual(result, [{
					// Note: technically this list should also
					// include the 2nd definition of `foo` in
					// deeprefs/e.ts, but there's no easy way to
					// discover it through file-level imports and
					// it is rare enough that we accept this
					// omission. (It would probably show up in the
					// definition response if the user has already
					// navigated to deeprefs/e.ts.)
					uri: 'file:///foo/c.ts',
					range: {
						start: {
							line: 0,
							character: 15
						},
						end: {
							line: 0,
							character: 38
						}
					}
				}]);
			});
			it('should resolve symbol imported with import statement', <any>async function (this: TestContext) {
				const result = await this.service.getDefinition({
					textDocument: {
						uri: 'file:///c.ts'
					},
					position: {
						line: 1,
						character: 2
					}
				});
				assert.deepEqual(result, [{
					uri: 'file:///foo/d.ts',
					range: {
						start: {
							line: 0,
							character: 0
						},
						end: {
							line: 0,
							character: 24
						}
					}
				}]);
			});
			it('should resolve definition with missing reference', <any>async function (this: TestContext) {
				const result = await this.service.getDefinition({
					textDocument: {
						uri: 'file:///missing/a.ts'
					},
					position: {
						line: 3,
						character: 21
					}
				});
				assert.deepEqual(result, [{
					uri: 'file:///missing/b.ts',
					range: {
						start: {
							line: 1,
							character: 4
						},
						end: {
							line: 3,
							character: 5
						}
					}
				}]);
			});
			it('should resolve deep definitions', <any>async function (this: TestContext) {
				// This test passes only because we expect no response from LSP server
				// for definition located in file references with depth 3 or more (a -> b -> c -> d (...))
				// This test will fail once we'll increase (or remove) depth limit
				const result = await this.service.getDefinition({
					textDocument: {
						uri: 'file:///deeprefs/a.ts'
					},
					position: {
						line: 2,
						character: 8
					}
				});
				assert.deepEqual(result, [{
					uri: 'file:///deeprefs/e.ts',
					range: {
						start: {
							line: 1,
							character: 0
						},
						end: {
							line: 1,
							character: 23
						}
					}
				}]);
			});
		});
	});

	describe('TypeScript libraries', function () {
		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
				['file:///tsconfig.json', JSON.stringify({
					compilerOptions: {
						lib: ['es2016', 'dom']
					}
				})],
				['file:///a.ts', "function foo(n: Node): {console.log(n.parentNode, NaN})}"]
		]))));
		describe('getHover()', <any>function (this: TestContext) {
			it('should load local library file', <any>async function (this: TestContext) {
				const result = await this.service.getHover({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 16
					}
				});
				assert.deepEqual(result, {
					range: {
						end: {
							character: 20,
							line: 0
						},
						start: {
							character: 16,
							line: 0
						}
					},
					contents: [{
						language: 'typescript',
						value: [
							'interface Node',
							'var Node: {',
							'    new (): Node;',
							'    prototype: Node;',
							'    readonly ATTRIBUTE_NODE: number;',
							'    readonly CDATA_SECTION_NODE: number;',
							'    readonly COMMENT_NODE: number;',
							'    readonly DOCUMENT_FRAGMENT_NODE: number;',
							'    readonly DOCUMENT_NODE: number;',
							'    readonly DOCUMENT_POSITION_CONTAINED_BY: number;',
							'    readonly DOCUMENT_POSITION_CONTAINS: number;',
							'    readonly DOCUMENT_POSITION_DISCONNECTED: number;',
							'    readonly DOCUMENT_POSITION_FOLLOWING: number;',
							'    readonly DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: number;',
							'    readonly DOCUMENT_POSITION_PRECEDING: number;',
							'    readonly DOCUMENT_TYPE_NODE: number;',
							'    readonly ELEMENT_NODE: number;',
							'    readonly ENTITY_NODE: number;',
							'    readonly ENTITY_REFERENCE_NODE: number;',
							'    readonly NOTATION_NODE: number;',
							'    readonly PROCESSING_INSTRUCTION_NODE: number;',
							'    readonly TEXT_NODE: number;',
							'}'
						].join('\n')
					}]
				});
			});
			it('should resolve TS libraries to github URL', <any>async function (this: TestContext) {
				assert.deepEqual(await this.service.getDefinition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 16
					}
				}), [{
					uri: 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/lib.dom.d.ts',
					range: {
						start: {
							line: 8750,
							character: 0
						},
						end: {
							line: 8800,
							character: 1
						}
					}
				}, {
					uri: 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/lib.dom.d.ts',
					range: {
						start: {
							line: 8802,
							character: 12
						},
						end: {
							line: 8823,
							character: 1
						}
					}
				}]);

				assert.deepEqual(await this.service.getDefinition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 50
					}
				}), [{
					uri: 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/lib.es5.d.ts',
					range: {
						start: {
							line: 24,
							character: 14
						},
						end: {
							line: 24,
							character: 25
						}
					}
				}]);
			});
		});
	});

	describe('getCompletions()', function () {
		beforeEach(<any>initializeTypeScriptService(new TestFileSystem(new Map([
			['file:///a.ts', [
				'class A {',
				'	/** foo doc*/',
				'    foo() {}',
				'	/** bar doc*/',
				'    bar(): number { return 1; }',
				'	/** baz doc*/',
				'    baz(): string { return ""; }',
				'	/** qux doc*/',
				'    qux: number;',
				'}',
				'const a = new A();',
				'a.'
			].join('\n')],
			['file:///uses-import.ts', [
				'import * as i from "./import"',
				'i.'
			].join('\n')],
			['file:///import.ts', '/** d doc*/ export function d() {}'],
			['file:///uses-reference.ts', [
				'/// <reference path="reference.ts" />',
				'let z : foo.'
			].join('\n')],
			['file:///reference.ts', [
				'namespace foo {',
				'	/** bar doc*/',
				'	export interface bar {}',
				'}'
			].join('\n')],
			['file:///empty.ts', '']
		]))));
		it('produces completions in the same file', <any>async function (this: TestContext) {
			const result = await this.service.getCompletions({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 11,
					character: 2
				}
			});
			assert.equal(result.isIncomplete, false);
			assert.sameDeepMembers(result.items, [
				{
					label: 'bar',
					kind: CompletionItemKind.Method,
					documentation: 'bar doc',
					sortText: '0',
					detail: '(method) A.bar(): number'
				},
				{
					label: 'baz',
					kind: CompletionItemKind.Method,
					documentation: 'baz doc',
					sortText: '0',
					detail: '(method) A.baz(): string'
				},
				{
					label: 'foo',
					kind: CompletionItemKind.Method,
					documentation: 'foo doc',
					sortText: '0',
					detail: '(method) A.foo(): void'
				},
				{
					label: 'qux',
					kind: CompletionItemKind.Property,
					documentation: 'qux doc',
					sortText: '0',
					detail: '(property) A.qux: number'
				}
			]);
		});
		it('produces completions for imported symbols', <any>async function (this: TestContext) {
			const result = await this.service.getCompletions({
				textDocument: {
					uri: 'file:///uses-import.ts'
				},
				position: {
					line: 1,
					character: 2
				}
			});
			assert.deepEqual(result, {
				isIncomplete: false,
				items: [{
					label: 'd',
					kind: CompletionItemKind.Function,
					documentation: 'd doc',
					detail: 'function d(): void',
					sortText: '0'
				}]
			});
		});
		it('produces completions for referenced symbols', <any>async function (this: TestContext) {
			const result = await this.service.getCompletions({
				textDocument: {
					uri: 'file:///uses-reference.ts'
				},
				position: {
					line: 1,
					character: 13
				}
			});
			assert.deepEqual(result, {
				isIncomplete: false,
				items: [{
					label: 'bar',
					kind: CompletionItemKind.Interface,
					documentation: 'bar doc',
					sortText: '0',
					detail: 'interface foo.bar'
				}]
			});
		});
		it('produces completions for empty files', <any>async function (this: TestContext) {
			const result = await this.service.getCompletions({
				textDocument: {
					uri: 'file:///empty.ts'
				},
				position: {
					line: 0,
					character: 0
				}
			});
			assert.notDeepEqual(result.items.length, []);
		});
	});
}
