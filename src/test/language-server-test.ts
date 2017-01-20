import * as ts from 'typescript';
import { CompletionItemKind } from 'vscode-languageserver';

import * as utils from './test-utils';

import { TypeScriptService } from '../typescript-service';
import { LanguageHandler } from '../lang-handler';

// forcing strict mode
import * as util from '../util';
util.setStrict(true);

export function testWithLangHandler(newLanguageHandler: () => LanguageHandler) {
	describe('LSP', function () {
		this.timeout(5000);
		describe('definitions and hovers', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "const abc = 1; console.log(abc);",
					'foo': {
						'b.ts': "/* This is class Foo */\nexport class Foo {}",
						'c.ts': "import {Foo} from './b';",
					},
					'd.ts': `\
export interface I {\n\
  target: string;\n\
}\
`,
					'e.ts': `\
import * as d from './d';\n\
\n\
let i: d.I = { target: "hi" };\n\
let target = i.target;\
`,
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('definition in same file', function (done: (err?: Error) => void) {
				utils.definition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				}, {
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
					}, done);
			});
			it('xdefinition on interface field reference', function (done: (err?: Error) => void) {
				utils.xdefinition({
					textDocument: {
						uri: 'file:///e.ts'
					},
					position: {
						line: 3,
						character: 15
					}
				}, {
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
							containerName: "I",
							containerKind: "",
							kind: "property",
							name: "target",
						},
					}, done);
			});
			it('xdefinition in same file', function (done: (err?: Error) => void) {
				utils.xdefinition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				}, {
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
							containerName: "",
							containerKind: "",
							kind: "const",
							name: "abc",
						},
					}, done);
			});
			it('definition on keyword (non-null)', function (done: (err?: Error) => void) {
				utils.definition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				}, [], done);
			});
			it('hover in same file', function (done: (err?: Error) => void) {
				utils.hover({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				}, {
						contents: [{
							language: 'typescript',
							value: 'const abc: 1'
						}]
					}, done);
			});
			it('definition in other file', function (done: (err?: Error) => void) {
				utils.definition({
					textDocument: {
						uri: 'file:///foo/c.ts'
					},
					position: {
						line: 0,
						character: 9
					}
				}, {
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
					}, done);
			});
			it('hover in other file', function (done: (err?: Error) => void) {
				utils.hover({
					textDocument: {
						uri: 'file:///foo/c.ts'
					},
					position: {
						line: 0,
						character: 9
					}
				}, {
						contents: [{
							language: 'typescript',
							value: 'import Foo'
						}]
					}, done);
			});
			it('hover over keyword (non-null)', function (done: (err?: Error) => void) {
				utils.hover({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				}, {
						contents: []
					}, done);
			});
			it('hover over non-existent file', function (done: (err?: Error) => void) {
				utils.hover({
					textDocument: {
						uri: 'file:///foo/a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				}, {
						contents: []
					}, done);
			});
		});
		describe('typings directory', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "import * as m from 'dep';",
					'typings': {
						'dep.d.ts': "declare module 'dep' {}",
					},
					'src': {
						'tsconfig.json': '\
{\n\
	"compilerOptions": {\n\
	"target": "ES5",\n\
	"module": "commonjs",\n\
		"sourceMap": true,\n\
		"noImplicitAny": false,\n\
		"removeComments": false,\n\
		"preserveConstEnums": true\n\
	}\n\
}',
						'tsd.d.ts': '/// <reference path="../typings/dep.d.ts" />',
						'dir': {
							'index.ts': 'import * as m from "dep";',
						}
					}
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('definition with tsd.d.ts', async function (done: (err?: Error) => void) {
				utils.definition({
					textDocument: {
						uri: 'file:///src/dir/index.ts'
					},
					position: {
						line: 0,
						character: 20
					}
				}, {
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
					}, done);
			});
			it('definition', async function (done: (err?: Error) => void) {
				try {
					await new Promise<void>((resolve, reject) => {
						utils.definition({
							textDocument: {
								uri: 'file:///a.ts'
							},
							position: {
								line: 0,
								character: 12
							}
						}, {
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
							}, err => err ? reject(err) : resolve());
					});
					await new Promise<void>((resolve, reject) => {
						utils.definition({
							textDocument: {
								uri: 'file:///a.ts'
							},
							position: {
								line: 0,
								character: 20
							}
						}, {
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
							}, err => err ? reject(err) : resolve());
					});
				} catch (e) {
					done(e);
					return;
				}
				done();
			});
		});
		describe('global module', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "const rt: GQL.Rt;",
					'interfaces.d.ts': 'declare namespace GQL { interface Rt { } }'
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('definition', async function (done: (err?: Error) => void) {
				utils.definition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 14
					}
				}, {
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
					}, done);
			});
		});
		describe('global modules in vendored deps', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "import * as fs from 'fs';",
					'node_modules': {
						'@types': {
							'node': {
								'index.d.ts': 'declare module "fs" {}',
							}
						}
					}
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('definition', async function (done: (err?: Error) => void) {
				try {
					await new Promise<void>((resolve, reject) => {
						utils.definition({
							textDocument: {
								uri: 'file:///a.ts'
							},
							position: {
								line: 0,
								character: 12
							}
						}, {
								uri: 'file:///node_modules/@types/node/index.d.ts',
								range: {
									start: {
										line: 0,
										character: 0
									},
									end: {
										line: 0,
										character: 22
									}
								}
							}, err => err ? reject(err) : resolve());
					});
					await new Promise<void>((resolve, reject) => {
						utils.definition({
							textDocument: {
								uri: 'file:///a.ts'
							},
							position: {
								line: 0,
								character: 21
							}
						}, {
								uri: 'file:///node_modules/@types/node/index.d.ts',
								range: {
									start: {
										line: 0,
										character: 0
									},
									end: {
										line: 0,
										character: 22
									}
								}
							}, err => err ? reject(err) : resolve());
					});
				} catch (e) {
					done(e);
					return;
				}
				done();
			});
		});
		describe('js-project-no-config', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.js': "module.exports = {foo: function() {}}",
					'foo': {
						'b.js': "var a = require('../a.js'); a.foo();",
						'c.js': "var a = require('../a.js'); a.foo();",
					}
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('produces references with declaration', function (done: (err?: Error) => void) {
				utils.references({
					textDocument: {
						uri: 'file:///a.js'
					},
					position: {
						line: 0,
						character: 20
					},
					context: {
						includeDeclaration: true
					}
				}, 3, done);
			});
			it('produces references without declaration', function (done: (err?: Error) => void) {
				utils.references({
					textDocument: {
						uri: 'file:///a.js'
					},
					position: {
						line: 0,
						character: 20
					},
					context: {
						includeDeclaration: false
					}
				}, 2, done);
			});
		});
		describe('workspace/symbol and textDocument/documentSymbol', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "class a { foo() { const i = 1;} }",
					'foo': {
						'b.ts': "class b { bar: number; baz(): number { return this.bar;}}; function qux() {}"
					},
					'node_modules': {
						'dep': {
							'index.ts': 'class DepClass {}',
						},
					},
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('document/symbol:a.ts', function (done: (err?: Error) => void) {
				utils.documentSymbols({
					textDocument: {
						uri: "file:///a.ts",
					}
				}, [
						{
							"kind": 5,
							"location": {
								"range": {
									"end": {
										"character": 33,
										"line": 0
									},
									"start": {
										"character": 0,
										"line": 0
									}
								},
								"uri": "file:///a.ts"
							},
							"name": "a"
						},
						{
							"containerName": "a",
							"kind": 6,
							"location": {
								"range": {
									"end": {
										"character": 31,
										"line": 0
									},
									"start": {
										"character": 10,
										"line": 0
									}
								},
								"uri": "file:///a.ts"
							},
							"name": "foo"
						},
						{
							"containerName": "foo",
							"kind": 15,
							"location": {
								"range": {
									"end": {
										"character": 29,
										"line": 0
									},
									"start": {
										"character": 24,
										"line": 0
									}
								},
								"uri": "file:///a.ts"
							},
							"name": "i"
						}
					], done);
			});
			it('document/symbol:foo/b.ts', function (done: (err?: Error) => void) {
				utils.documentSymbols({
					textDocument: {
						uri: "file:///foo/b.ts",
					}
				}, [
						{
							"kind": 5,
							"location": {
								"range": {
									"end": {
										"character": 57,
										"line": 0
									},
									"start": {
										"character": 0,
										"line": 0
									}
								},
								"uri": "file:///foo/b.ts"
							},
							"name": "b"
						},
						{
							"containerName": "b",
							"kind": 7,
							"location": {
								"range": {
									"end": {
										"character": 22,
										"line": 0
									},
									"start": {
										"character": 10,
										"line": 0
									},
								},
								"uri": "file:///foo/b.ts"
							},
							"name": "bar"
						},
						{
							"containerName": "b",
							"kind": 6,
							"location": {
								"range": {
									"end": {
										"character": 56,
										"line": 0
									},
									"start": {
										"character": 23,
										"line": 0
									},
								},
								"uri": "file:///foo/b.ts",
							},
							"name": "baz"
						},
						{
							"kind": 12,
							"location": {
								"range": {
									"end": {
										"character": 76,
										"line": 0
									},
									"start": {
										"character": 59,
										"line": 0
									},
								},
								"uri": "file:///foo/b.ts",
							},
							"name": "qux",
						}
					], done);
			});
			it('workspace symbols with empty query', function (done: (err?: Error) => void) {
				utils.symbols({
					query: '',
					limit: 3
				}, [
						{
							"kind": 5,
							"location": {
								"range": {
									"end": {
										"character": 33,
										"line": 0
									},
									"start": {
										"character": 0,
										"line": 0
									}
								},
								"uri": "file:///a.ts"
							},
							"name": "a"
						},
						{
							"kind": 5,
							"location": {
								"range": {
									"end": {
										"character": 57,
										"line": 0
									},
									"start": {
										"character": 0,
										"line": 0
									}
								},
								"uri": "file:///foo/b.ts"
							},
							"name": "b"
						},
						{
							"containerName": "b",
							"kind": 7,
							"location": {
								"range": {
									"end": {
										"character": 22,
										"line": 0
									},
									"start": {
										"character": 10,
										"line": 0
									}
								},
								"uri": "file:///foo/b.ts"
							},
							"name": "bar"
						}
					], done);
			});
			it('workspace symbols with not-empty query', function (done: (err?: Error) => void) {
				utils.symbols({
					query: 'ba',
					limit: 100
				}, [
						{
							"containerName": "b",
							"kind": 7,
							"location": {
								"range": {
									"end": {
										"character": 22,
										"line": 0
									},
									"start": {
										"character": 10,
										"line": 0
									},
								},
								"uri": "file:///foo/b.ts"
							},
							"name": "bar"
						},
						{
							"containerName": "b",
							"kind": 6,
							"location": {
								"range": {
									"end": {
										"character": 56,
										"line": 0
									},
									"start": {
										"character": 23,
										"line": 0
									}
								},
								"uri": "file:///foo/b.ts"
							},
							"name": "baz"
						}
					]

					, done);
			});
			it('workspace symbols does not return symbols in dependencies', function (done: (err?: Error) => void) {
				utils.symbols({
					query: 'DepClass',
					limit: 100
				}, [], done);
			});
			it('workspace/symbols with partial SymbolDescriptor query', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { name: 'a' },
					limit: 10,
				}, [{
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
							}
						},
						"uri": "file:///a.ts",
					},
					"name": "a",
				}], done);
			});
			it('workspace/symbols with full SymbolDescriptor query 1', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { name: 'a', kind: 'class', containerName: '', containerKind: '' },
					limit: 10,
				}, [{
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
							}
						},
						"uri": "file:///a.ts",
					},
					"name": "a",
				}], done);
			});
			it('workspace/symbols with full SymbolDescriptor query 2', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { name: 'baz', kind: 'method', containerName: 'b', containerKind: 'class' },
					limit: 10,
				}, [{
					"containerName": "b",
					"kind": 6,
					"location": {
						"range": {
							"end": {
								"character": 56,
								"line": 0,
							},
							"start": {
								"character": 23,
								"line": 0,
							},
						},
						"uri": "file:///foo/b.ts",
					},
					"name": "baz",
				}], done);
			});
		});
		describe('workspace/symbol with dependencies', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "class MyClass {}",
					'node_modules': {
						'dep': {
							'index.d.ts': 'class TheirClass {}',
						},
					},
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('workspace symbols with empty query', function (done: (err?: Error) => void) {
				utils.symbols({
					query: '',
					limit: 100
				}, [{
					"kind": 5,
					"location": {
						"range": {
							"end": {
								"character": 16,
								"line": 0
							},
							"start": {
								"character": 0,
								"line": 0
							},
						},
						"uri": "file:///a.ts",
					},
					"name": "MyClass"
				}], done);
			});
			it('workspace symbols with not-empty query', function (done: (err?: Error) => void) {
				utils.symbols({
					query: 'TheirClass',
					limit: 100
				}, [], done);
			});
			it('workspace symbols does not return symbols in dependencies', function (done: (err?: Error) => void) {
				utils.symbols({
					query: 'DepClass',
					limit: 100
				}, [], done);
			});
		});
		describe('DefinitelyTyped', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'package.json': `\
{\n\
  "private": true,\n\
  "name": "definitely-typed",\n\
  "version": "0.0.1",\n\
  "homepage": "https://github.com/DefinitelyTyped/DefinitelyTyped",\n\
  "repository": {\n\
	"type": "git",\n\
	"url": "git+https://github.com/DefinitelyTyped/DefinitelyTyped.git"\n\
  },\n\
  "license": "MIT",\n\
  "bugs": {\n\
	"url": "https://github.com/DefinitelyTyped/DefinitelyTyped/issues"\n\
  },\n\
  "engines": {\n\
	"node": ">= 6.9.1"\n\
  },\n\
  "scripts": {\n\
	"compile-scripts": "tsc -p scripts",\n\
	"new-package": "node scripts/new-package.js",\n\
	"not-needed": "node scripts/not-needed.js",\n\
	"lint": "node scripts/lint.js",\n\
	"test": "node node_modules/types-publisher/bin/tester/test.js --run-from-definitely-typed --nProcesses 1"\n\
  },\n\
  "devDependencies": {\n\
	"types-publisher": "Microsoft/types-publisher#production"\n\
  }\n\
}\
					`,
					'resolve': {
						'index.d.ts': '\
/// <reference types="node" />\n\
\n\
type resolveCallback = (err: Error, resolved?: string) => void;\n\
declare function resolve(id: string, cb: resolveCallback): void;\n\
',
						'tsconfig.json': '\
{\n\
    "compilerOptions": {\n\
        "module": "commonjs",\n\
        "lib": [\n\
            "es6"\n\
        ],\n\
        "noImplicitAny": true,\n\
        "noImplicitThis": true,\n\
        "strictNullChecks": false,\n\
        "baseUrl": "../",\n\
        "typeRoots": [\n\
            "../"\n\
        ],\n\
        "types": [],\n\
        "noEmit": true,\n\
        "forceConsistentCasingInFileNames": true\n\
    },\n\
    "files": [\n\
        "index.d.ts"\n\
    ]\n\
}',
					},
					'notResolve': {
						'index.d.ts': '\
/// <reference types="node" />\n\
\n\
type resolveCallback = (err: Error, resolved?: string) => void;\n\
declare function resolve(id: string, cb: resolveCallback): void;\n\
',
						'tsconfig.json': '\
{\n\
    "compilerOptions": {\n\
        "module": "commonjs",\n\
        "lib": [\n\
            "es6"\n\
        ],\n\
        "noImplicitAny": true,\n\
        "noImplicitThis": true,\n\
        "strictNullChecks": false,\n\
        "baseUrl": "../",\n\
        "typeRoots": [\n\
            "../"\n\
        ],\n\
        "types": [],\n\
        "noEmit": true,\n\
        "forceConsistentCasingInFileNames": true\n\
    },\n\
    "files": [\n\
        "index.d.ts"\n\
    ]\n\
}',
					},
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('workspace/symbol symbol query: resolve, with package', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { 'name': 'resolveCallback', 'package': { 'name': '@types/resolve' } },
					limit: 10,
				}, [{
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
				}], done);
			});
			it('workspace/symbol symbol query: resolve, with package, empty containerKind', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { 'name': 'resolveCallback', 'containerKind': '', 'package': { 'name': '@types/resolve' } },
					limit: 10,
				}, [{
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
				}], done);
			});
		});
		describe('project with root package.json', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': 'class a { foo() { const i = 1;} }',
					'foo': {
						'b.ts': "class b { bar: number; baz(): number { return this.bar;}}; function qux() {}"
					},
					'c.ts': 'import { x } from "dep/dep";',
					'package.json': '{ "name": "mypkg" }',
					'node_modules': {
						'dep': {
							'dep.ts': 'export var x = 1;',
						}
					}
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('workspace/symbol symbol query with package', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { name: 'a', kind: 'class', package: { name: 'mypkg' } },
					limit: 10,
				}, [{
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
				}], done);
			});
			it('workspace/symbol symbol query with package, with package version (ignored)', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { name: 'a', kind: 'class', package: { name: 'mypkg', version: "203940234" } },
					limit: 10,
				}, [{
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
				}], done);
			});
			it('workspace/symbol text query: a', function (done: (err?: Error) => void) {
				utils.symbols({
					query: 'a',
					limit: 10,
				}, [{
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
				}], done);
			});
			it('workspace/symbol symbol query: a', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { 'name': 'a' },
					limit: 10,
				}, [{
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
				}], done);
			});
			it('workspace/symbol symbol query with wrong package', function (done: (err?: Error) => void) {
				utils.symbols({
					symbol: { name: 'a', kind: 'class', package: { name: "not-mypkg" } },
					limit: 10,
				}, [], done);
			});
			it('workspace/xreferences "foo"', function (done: (err?: Error) => void) {
				utils.workspaceReferences({ query: { "name": "foo", "kind": "method", "containerName": "a" } }, [{
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
				}], done);
			});
			it('workspace/xreferences "foo", with hint', function (done: (err?: Error) => void) {
				utils.workspaceReferences({ query: { "name": "foo", "kind": "method", "containerName": "a" }, hints: { dependeePackageName: "mypkg" } }, [{
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
				}], done);
			});
			it('workspace/xreferences "foo", with hint, not found', function (done: (err?: Error) => void) {
				utils.workspaceReferences({ query: { "name": "foo", "kind": "method", "containerName": "a" }, hints: { dependeePackageName: "NOT-mypkg" } }, [], done);
			});
			it('workspace/xreference dep reference', function (done: (err?: Error) => void) {
				utils.workspaceReferences({ query: { "name": "x", "containerName": "/node_modules/dep/dep" } }, [{
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
				}], done);
			});
			it('workspace/xreferences all references', function (done: (err?: Error) => void) {
				utils.workspaceReferences({ query: {} }, [
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
				], done);
			});
		});
		describe('workspace/xdependencies and workspace/xpackages', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'package.json': '\
{\
  "name": "tslint",\
  "version": "4.0.2",\
  "dependencies": {\
    "babel-code-frame": "^6.16.0",\
    "findup-sync": "~0.3.0"\
  },\
  "devDependencies": {\
    "@types/babel-code-frame": "^6.16.0",\
    "@types/optimist": "0.0.29",\
    "chai": "^3.0.0",\
    "tslint": "latest",\
    "tslint-test-config-non-relative": "file:test/external/tslint-test-config-non-relative",\
    "typescript": "2.0.10"\
  },\
  "peerDependencies": {\
    "typescript": ">=2.0.0"\
  }\
}',
					'node_modules': {
						'dep': {
							'package.json': '{ "name": "foo", "dependencies": { "shouldnotinclude": "0.0.0" } }',
						},
					},
					'subproject': {
						'package.json': '\
{\
  "name": "subproject", \
  "repository": {\
    "url": "https://github.com/my/subproject"\
  },\
  "dependencies": { "subproject-dep": "0.0.0" }\
}',
					},
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('all dependencies accounted for', function (done: (err?: Error) => void) {
				utils.dependencies([
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
				]
					, done);
			});
			it('all packages accounted for', function (done: (err?: Error) => void) {
				utils.packages([{
					package: {
						name: 'tslint',
						version: '4.0.2',
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
						repoURL: "https://github.com/my/subproject",
					},
					dependencies: [
						{ attributes: { 'name': "subproject-dep", 'version': "0.0.0" }, hints: { 'dependeePackageName': 'subproject' } },
					],
				}]
					, done);
			});
		});
		describe('sourcegraph/sourcegraph#2052', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "let parameters = [];"
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('type of parameters should be "any[]"', function (done: (err?: Error) => void) {
				utils.hover({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 5
					}
				}, {
						contents: [{
							language: 'typescript',
							value: 'let parameters: any[]'
						}]
					}
					, done);
			});
		});
		describe('live updates', function () {
			this.timeout(10000);
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': 'let parameters = [];'
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('hover updates', function (done: (err?: Error) => void) {

				const input = {
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 5
					}
				};

				const expected = [{
					contents: [{
						language: 'typescript',
						value: 'let parameters: any[]'
					}]
				}, {
					contents: [{
						language: 'typescript',
						value: 'let parameters: string[]'
					}]
				}, {
					contents: [{
						language: 'typescript',
						value: 'let parameters: number[]'
					}]
				}, {
					contents: [{
						language: 'typescript',
						value: 'let parameters: any[]'
					}]
				}];

				utils.hover(input, expected[0], (err) => {
					if (err) {
						return done(err);
					}
					utils.open('file:///a.ts', 'let parameters: string[]');
					utils.hover(input, expected[1], (err) => {
						if (err) {
							return done(err);
						}
						utils.change('file:///a.ts', 'let parameters: number[]');
						utils.hover(input, expected[2], (err) => {
							if (err) {
								return done(err);
							}
							utils.close('file:///a.ts');
							utils.hover(input, expected[3], done);
						});
					});
				});
			});
		});
		describe('references and imports', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': '/// <reference path="b.ts"/>\nnamespace qux {let f : foo;}',
					'b.ts': '/// <reference path="foo/c.ts"/>',
					'c.ts': 'import * as d from "./foo/d"\nd.bar()',
					'foo': {
						'c.ts': 'namespace qux {export interface foo {}}',
						'd.ts': 'export function bar() {}'
					},
					'deeprefs': {
						'a.ts': '/// <reference path="b.ts"/>\nnamespace qux {\nlet f : foo;\n}',
						'b.ts': '/// <reference path="c.ts"/>',
						'c.ts': '/// <reference path="d.ts"/>',
						'd.ts': '/// <reference path="e.ts"/>',
						'e.ts': 'namespace qux {\nexport interface foo {}\n}',
					},
					'missing': {
						'a.ts': '/// <reference path="b.ts"/>\n/// <reference path="missing.ts"/>\nnamespace t {\n    function foo() : Bar {\n        return null;\n    }\n}',
						'b.ts': 'namespace t {\n    export interface Bar {\n        id?: number;\n    }}'
					}
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('definition', function (done: (err?: Error) => void) {
				utils.definition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 1,
						character: 23
					}
				}, {
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
					}, (err) => {
						if (err) {
							return done(err);
						}
						utils.definition({
							textDocument: {
								uri: 'file:///c.ts'
							},
							position: {
								line: 1,
								character: 2
							}
						}, {
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
							}, done);
					});
			});
			it('definition with missing ref', function (done: (err?: Error) => void) {
				utils.definition({
					textDocument: {
						uri: 'file:///missing/a.ts'
					},
					position: {
						line: 3,
						character: 21
					}
				}, {
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
					}, done);
			});
			it('should resolve deep definitions', function (done: (err?: Error) => void) {
				// This test passes only because we expect no response from LSP server
				// for definition located in file references with depth 3 or more (a -> b -> c -> d (...))
				// This test will fail once we'll increase (or remove) depth limit
				utils.definition({
					textDocument: {
						uri: 'file:///deeprefs/a.ts'
					},
					position: {
						line: 2,
						character: 8
					}
				}, {
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
					}, done);
			});
		});
		describe('typescript libs', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'tsconfig.json': JSON.stringify({
						compilerOptions: {
							lib: ['es2016', 'dom']
						}
					}),
					'a.ts': "function foo(n: Node): {console.log(n.parentNode, NaN})}"
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('should load local library file', function (done: (err?: Error) => void) {
				utils.hover({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 16
					}
				}, {
						contents: [{
							language: 'typescript',
							value: '\
interface Node\n\
var Node: {\n\
    new (): Node;\n\
    prototype: Node;\n\
    readonly ATTRIBUTE_NODE: number;\n\
    readonly CDATA_SECTION_NODE: number;\n\
    readonly COMMENT_NODE: number;\n\
    readonly DOCUMENT_FRAGMENT_NODE: number;\n\
    readonly DOCUMENT_NODE: number;\n\
    readonly DOCUMENT_POSITION_CONTAINED_BY: number;\n\
    readonly DOCUMENT_POSITION_CONTAINS: number;\n\
    readonly DOCUMENT_POSITION_DISCONNECTED: number;\n\
    readonly DOCUMENT_POSITION_FOLLOWING: number;\n\
    readonly DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: number;\n\
    readonly DOCUMENT_POSITION_PRECEDING: number;\n\
    readonly DOCUMENT_TYPE_NODE: number;\n\
    readonly ELEMENT_NODE: number;\n\
    readonly ENTITY_NODE: number;\n\
    readonly ENTITY_REFERENCE_NODE: number;\n\
    readonly NOTATION_NODE: number;\n\
    readonly PROCESSING_INSTRUCTION_NODE: number;\n\
    readonly TEXT_NODE: number;\n\
}'
						}]
					}, done);
			});
			it('should resolve TS libraries to github URL', function (done: (err?: Error) => void) {
				utils.definition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 16
					}
				}, [{
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
				}], (err) => {
					if (err) {
						return done(err);
					}
					utils.definition({
						textDocument: {
							uri: 'file:///a.ts'
						},
						position: {
							line: 0,
							character: 50
						}
					}, {
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
						}, done);
				});
			});
		});
		describe('completions', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': `class A {
	/** foo doc*/
    foo() {}
	/** bar doc*/
    bar(): number { return 1; }
	/** baz doc*/
    baz(): string { return ''; }
	/** qux doc*/
    qux: number;
}
const a = new A();
a.`,
					'uses-import.ts': `import * as i from "./import"
i.`,
					'import.ts': `/** d doc*/ export function d() {}`,
					'uses-reference.ts': `/// <reference path="reference.ts" />
let z : foo.`,
					'reference.ts': `namespace foo { 
	/** bar doc*/
	export interface bar {}
}`
				}, done);
			});
			after(function (done: () => void) {
				utils.tearDown(done);
			});
			it('produces completions in the same file', function (done: (err?: Error) => void) {
				utils.completions({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 11,
						character: 2
					}
				}, [
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
						}], done);
			});
			it('produces completions for imported symbols', function (done: (err?: Error) => void) {
				utils.completions({
					textDocument: {
						uri: 'file:///uses-import.ts'
					},
					position: {
						line: 1,
						character: 2
					}
				}, [{
					label: 'd',
					kind: CompletionItemKind.Function,
					documentation: 'd doc',
					detail: 'function d(): void',
					sortText: '0'
				}], done);
			});
			it('produces completions for referenced symbols', function (done: (err?: Error) => void) {
				utils.completions({
					textDocument: {
						uri: 'file:///uses-reference.ts'
					},
					position: {
						line: 1,
						character: 13
					}
				}, [{
					label: 'bar',
					kind: CompletionItemKind.Interface,
					documentation: 'bar doc',
					sortText: '0',
					detail: 'interface foo.bar'
				}], done);
			});
		});
	});
}

testWithLangHandler(() => new TypeScriptService());
