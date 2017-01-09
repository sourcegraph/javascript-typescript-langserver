import * as ts from 'typescript';
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
					}
				}, done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
			});
		});
		describe('global module', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "const rt: GQL.Rt;",
					'interfaces.d.ts': 'declare namespace GQL { interface Rt { } }'
				}, done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
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
			it('references', function (done: (err?: Error) => void) {
				utils.references({
					textDocument: {
						uri: 'file:///a.js'
					},
					position: {
						line: 0,
						character: 20
					}
				}, 3, done);
			});
			afterEach(function (done: () => void) {
				utils.tearDown(done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
			});
		});
		describe('workspace/reference', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "class a { foo() { const i = 1;} }",
					'foo': {
						'b.ts': "class b { bar: number; baz(): number { return this.bar;}}; function qux() {}"
					}
				}, done);
			});
			it('foo references', function (done: (err?: Error) => void) {
				utils.workspaceReferences({ query: { "name": "foo", "kind": "method", "containerName": "a" } }, [
					{
						"symbol": {
							"containerName": "a",
							"name": "foo",
							"kind": "method",
						},
						"location": {
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
					}
				], done);
			});
			it('all references', function (done: (err?: Error) => void) {
				utils.workspaceReferences({ query: {} }, [
					{
						"symbol": {
							"containerName": "",
							"kind": "class",
							"name": "a",
						},
						"location": {
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
							"name": "foo",
							"kind": "method",
						},
						"location": {
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
							"name": "i",
							"kind": "const",
						},
						"location": {
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
						"symbol": {
							"containerName": "",
							"name": "b",
							"kind": "class",
						},
						"location": {
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
							"name": "bar",
							"kind": "property",
						},
						"location": {
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
							"name": "baz",
							"kind": "method",
						},
						"location": {
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
							"name": "bar",
							"kind": "property",
						},
						"location": {
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
							"name": "qux",
							"kind": "function",
						},
						"location": {
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
			});
		});
		describe('sourcegraph/sourcegraph#2052', function () {
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': "let parameters = [];"
				}, done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
			});
		});
		describe('live updates', function () {
			this.timeout(10000);
			before(function (done: () => void) {
				utils.setUp(newLanguageHandler(), {
					'a.ts': 'let parameters = [];'
				}, done);
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
					afterEach(function (done: () => void) {
						utils.tearDown(done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
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
			afterEach(function (done: () => void) {
				utils.tearDown(done);
			});
		});
	});
}

testWithLangHandler(() => new TypeScriptService());
