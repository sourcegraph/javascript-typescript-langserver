import * as chai from 'chai';
import * as sinon from 'sinon';
import * as ts from 'typescript';
import { CompletionItemKind, CompletionList, DiagnosticSeverity, TextDocumentIdentifier, TextDocumentItem, WorkspaceEdit } from 'vscode-languageserver';
import { Command, Diagnostic, Hover, Location, SignatureHelp, SymbolInformation, SymbolKind } from 'vscode-languageserver-types';
import { LanguageClient, RemoteLanguageClient } from '../lang-handler';
import { TextDocumentContentParams, WorkspaceFilesParams } from '../request-type';
import { SymbolLocationInformation } from '../request-type';
import { TypeScriptService, TypeScriptServiceFactory } from '../typescript-service';
import chaiAsPromised = require('chai-as-promised');
import { apply } from 'json-patch';
import { ISuiteCallbackContext, ITestCallbackContext } from 'mocha';
chai.use(chaiAsPromised);
const assert = chai.assert;

/**
 * Enforcing strict mode to make tests pass on Windows
 */
import { setStrict, uri2path } from '../util';
setStrict(true);

export interface TestContext {

	/** TypeScript service under test */
	service: TypeScriptService;

	/** Stubbed LanguageClient */
	client: { [K in keyof LanguageClient]: LanguageClient[K] & sinon.SinonStub };
}

/**
 * Returns a function that initializes the test context with a TypeScriptService instance and initializes it (to be used in `beforeEach`)
 *
 * @param createService A factory that creates the TypeScript service. Allows to test subclasses of TypeScriptService
 * @param files A Map from URI to file content of files that should be available in the workspace
 */
export const initializeTypeScriptService = (createService: TypeScriptServiceFactory, rootUri: string, files: Map<string, string>) => async function (this: TestContext): Promise<void> {

	// Stub client
	this.client = sinon.createStubInstance(RemoteLanguageClient);
	this.client.textDocumentXcontent.callsFake(async (params: TextDocumentContentParams): Promise<TextDocumentItem> => {
		if (!files.has(params.textDocument.uri)) {
			throw new Error(`Text document ${params.textDocument.uri} does not exist`);
		}
		return {
			uri: params.textDocument.uri,
			text: files.get(params.textDocument.uri)!,
			version: 1,
			languageId: ''
		};
	});
	this.client.workspaceXfiles.callsFake(async (params: WorkspaceFilesParams): Promise<TextDocumentIdentifier[]> => {
		return Array.from(files.keys()).map(uri => ({ uri }));
	});
	this.client.xcacheGet.returns(null);
	this.client.workspaceApplyEdit.returns(Promise.resolve({applied: true}));
	this.service = createService(this.client);

	await this.service.initialize({
		processId: process.pid,
		rootUri,
		capabilities: {
			xcontentProvider: true,
			xfilesProvider: true
		}
	}).toPromise();
};

/**
 * Shuts the TypeScriptService down (to be used in `afterEach()`)
 */
export async function shutdownTypeScriptService(this: TestContext): Promise<void> {
	await this.service.shutdown().toPromise();
}

/**
 * Describe a TypeScriptService class
 *
 * @param createService Factory function to create the TypeScriptService instance to describe
 */
export function describeTypeScriptService(createService: TypeScriptServiceFactory, shutdownService = shutdownTypeScriptService, rootUri: string) {

	describe('Workspace without project files', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'a.ts', 'const abc = 1; console.log(abc);'],
			[rootUri + 'foo/b.ts', [
				'/* This is class Foo */',
				'export class Foo {}'
			].join('\n')],
			[rootUri + 'foo/c.ts', 'import {Foo} from "./b";'],
			[rootUri + 'd.ts', [
				'export interface I {',
				'  target: string;',
				'}'
			].join('\n')],
			[rootUri + 'e.ts', [
				'import * as d from "./d";',
				'',
				'let i: d.I = { target: "hi" };',
				'let target = i.target;'
			].join('\n')]
		])) as any);

		afterEach(shutdownService as any);

		describe('textDocumentDefinition()', function (this: TestContext) {
			specify('in same file', async function (this: TestContext) {
				const result: Location[] = await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					uri: rootUri + 'a.ts',
					range: {
						start: {
							line: 0,
							character: 6
						},
						end: {
							line: 0,
							character: 9
						}
					}
				}]);
			} as any);
			specify('on keyword (non-null)', async function (this: TestContext) {
				const result: Location[] = await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, []);
			} as any);
			specify('in other file', async function (this: TestContext) {
				const result: Location[] = await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'foo/c.ts'
					},
					position: {
						line: 0,
						character: 9
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					uri: rootUri + 'foo/b.ts',
					range: {
						start: {
							line: 1,
							character: 13
						},
						end: {
							line: 1,
							character: 16
						}
					}
				}]);
			} as any);
		} as any);
		describe('textDocumentXdefinition()', function (this: TestContext) {
			specify('on interface field reference', async function (this: TestContext) {
				const result: SymbolLocationInformation[] = await this.service.textDocumentXdefinition({
					textDocument: {
						uri: rootUri + 'e.ts'
					},
					position: {
						line: 3,
						character: 15
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					location: {
						uri: rootUri + 'd.ts',
						range: {
							start: {
								line: 1,
								character: 2
							},
							end: {
								line: 1,
								character: 8
							}
						}
					},
					symbol: {
						filePath: 'd.ts',
						containerName: 'd.I',
						containerKind: '',
						kind: 'property',
						name: 'target'
					}
				}]);
			} as any);
			specify('in same file', async function (this: TestContext) {
				const result: SymbolLocationInformation[] = await this.service.textDocumentXdefinition({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					location: {
						uri: rootUri + 'a.ts',
						range: {
							start: {
								line: 0,
								character: 6
							},
							end: {
								line: 0,
								character: 9
							}
						}
					},
					symbol: {
						filePath: 'a.ts',
						containerName: '"a"',
						containerKind: 'module',
						kind: 'const',
						name: 'abc'
					}
				}]);
			} as any);
		} as any);
		describe('textDocumentHover()', function (this: TestContext) {
			specify('in same file', async function (this: TestContext) {
				const result: Hover = await this.service.textDocumentHover({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
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
					contents: [
						{ language: 'typescript', value: 'const abc: 1' },
						'**const**'
					]
				});
			} as any);
			specify('in other file', async function (this: TestContext) {
				const result: Hover = await this.service.textDocumentHover({
					textDocument: {
						uri: rootUri + 'foo/c.ts'
					},
					position: {
						line: 0,
						character: 9
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
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
					contents: [
						{ language: 'typescript', value: 'import Foo' },
						'**alias**'
					]
				});
			} as any);
			specify('over keyword (non-null)', async function (this: TestContext) {
				const result: Hover = await this.service.textDocumentHover({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, { contents: [] });
			} as any);
			specify('over non-existent file', function (this: TestContext) {
				return assert.isRejected(this.service.textDocumentHover({
					textDocument: {
						uri: rootUri + 'foo/a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				}).toPromise());
			} as any);
		} as any);
	} as any);

	describe('Workspace with typings directory', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'src/a.ts', "import * as m from 'dep';"],
			[rootUri + 'typings/dep.d.ts', "declare module 'dep' {}"],
			[rootUri + 'src/tsconfig.json', [
				'{',
				'  "compilerOptions": {',
				'    "target": "ES5",',
				'    "module": "commonjs",',
				'    "sourceMap": true,',
				'    "noImplicitAny": false,',
				'    "removeComments": false,',
				'    "preserveConstEnums": true',
				'  }',
				'}'
			].join('\n')],
			[rootUri + 'src/tsd.d.ts', '/// <reference path="../typings/dep.d.ts" />'],
			[rootUri + 'src/dir/index.ts', 'import * as m from "dep";']
		])) as any);

		afterEach(shutdownService as any);

		describe('textDocumentDefinition()', function (this: TestContext) {
			specify('with tsd.d.ts', async function (this: TestContext) {
				const result: Location[] = await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'src/dir/index.ts'
					},
					position: {
						line: 0,
						character: 20
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					uri: rootUri + 'typings/dep.d.ts',
					range: {
						start: {
							line: 0,
							character: 15
						},
						end: {
							line: 0,
							character: 20
						}
					}
				}]);
			} as any);
			describe('on file in project root', function (this: TestContext) {
				specify('on import alias', async function (this: TestContext) {
					const result: Location[] = await this.service.textDocumentDefinition({
						textDocument: {
							uri: rootUri + 'src/a.ts'
						},
						position: {
							line: 0,
							character: 12
						}
					}).toArray().map(patches => apply(null, patches)).toPromise();
					assert.deepEqual(result, [{
						uri: rootUri + 'typings/dep.d.ts',
						range: {
							start: {
								line: 0,
								character: 15
							},
							end: {
								line: 0,
								character: 20
							}
						}
					}]);
				} as any);
				specify('on module name', async function (this: TestContext) {
					const result: Location[] = await this.service.textDocumentDefinition({
						textDocument: {
							uri: rootUri + 'src/a.ts'
						},
						position: {
							line: 0,
							character: 20
						}
					}).toArray().map(patches => apply(null, patches)).toPromise();
					assert.deepEqual(result, [{
						uri: rootUri + 'typings/dep.d.ts',
						range: {
							start: {
								line: 0,
								character: 15
							},
							end: {
								line: 0,
								character: 20
							}
						}
					}]);
				} as any);
			} as any);
		} as any);
	} as any);

	describe('DefinitelyTyped', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'package.json', JSON.stringify({
				private: true,
				name: 'definitely-typed',
				version: '0.0.1',
				homepage: 'https://github.com/DefinitelyTyped/DefinitelyTyped',
				repository: {
					type: 'git',
					url: 'git+https://github.com/DefinitelyTyped/DefinitelyTyped.git'
				},
				license: 'MIT',
				bugs: {
					url: 'https://github.com/DefinitelyTyped/DefinitelyTyped/issues'
				},
				engines: {
					node: '>= 6.9.1'
				},
				scripts: {
					'compile-scripts': 'tsc -p scripts',
					'new-package': 'node scripts/new-package.js',
					'not-needed': 'node scripts/not-needed.js',
					'lint': 'node scripts/lint.js',
					'test': 'node node_modules/types-publisher/bin/tester/test.js --run-from-definitely-typed --nProcesses 1'
				},
				devDependencies: {
					'types-publisher': 'Microsoft/types-publisher#production'
				}
			}, null, 4)],
			[rootUri + 'types/resolve/index.d.ts', [
				'/// <reference types="node" />',
				'',
				'type resolveCallback = (err: Error, resolved?: string) => void;',
				'declare function resolve(id: string, cb: resolveCallback): void;',
				''
			].join('\n')],
			[rootUri + 'types/resolve/tsconfig.json', JSON.stringify({
				compilerOptions: {
					module: 'commonjs',
					lib: [
						'es6'
					],
					noImplicitAny: true,
					noImplicitThis: true,
					strictNullChecks: false,
					baseUrl: '../',
					typeRoots: [
						'../'
					],
					types: [],
					noEmit: true,
					forceConsistentCasingInFileNames: true
				},
				files: [
					'index.d.ts'
				]
			})],
			[rootUri + 'types/notResolve/index.d.ts', [
				'/// <reference types="node" />',
				'',
				'type resolveCallback = (err: Error, resolved?: string) => void;',
				'declare function resolve(id: string, cb: resolveCallback): void;',
				''
			].join('\n')],
			[rootUri + 'types/notResolve/tsconfig.json', JSON.stringify({
				compilerOptions: {
					module: 'commonjs',
					lib: [
						'es6'
					],
					noImplicitAny: true,
					noImplicitThis: true,
					strictNullChecks: false,
					baseUrl: '../',
					typeRoots: [
						'../'
					],
					types: [],
					noEmit: true,
					forceConsistentCasingInFileNames: true
				},
				files: [
					'index.d.ts'
				]
			})]
		])) as any);

		afterEach(shutdownService as any);

		describe('workspaceSymbol()', function (this: TestContext) {
			it('should find a symbol by SymbolDescriptor query with name and package name', async function (this: TestContext) {
				const result: SymbolInformation[] = await this.service.workspaceSymbol({
					symbol: { name: 'resolveCallback', package: { name: '@types/resolve' } }
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					kind: SymbolKind.Variable,
					location: {
						range: {
							end: {
								character: 63,
								line: 2
							},
							start: {
								character: 0,
								line: 2
							}
						},
						uri: rootUri + 'types/resolve/index.d.ts'
					},
					name: 'resolveCallback'
				}]);
			} as any);
			it('should find a symbol by SymbolDescriptor query with name, containerKind and package name', async function (this: TestContext) {
				const result: SymbolInformation[] = await this.service.workspaceSymbol({
					symbol: {
						name: 'resolveCallback',
						containerKind: 'module',
						package: {
							name: '@types/resolve'
						}
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result[0], {
					kind: SymbolKind.Variable,
					location: {
						range: {
							end: {
								character: 63,
								line: 2
							},
							start: {
								character: 0,
								line: 2
							}
						},
						uri: rootUri + 'types/resolve/index.d.ts'
					},
					name: 'resolveCallback'
				});
			} as any);
		} as any);
	} as any);

	describe('Workspace with root package.json', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'a.ts', 'class a { foo() { const i = 1;} }'],
			[rootUri + 'foo/b.ts', 'class b { bar: number; baz(): number { return this.bar;}}; function qux() {}'],
			[rootUri + 'c.ts', 'import { x } from "dep/dep";'],
			[rootUri + 'package.json', '{ "name": "mypkg" }'],
			[rootUri + 'node_modules/dep/dep.ts', 'export var x = 1;']
		])) as any);

		afterEach(shutdownService as any);

		describe('workspaceSymbol()', function (this: TestContext) {
			describe('with SymbolDescriptor query', function (this: TestContext) {
				it('should find a symbol by name, kind and package name', async function (this: TestContext) {
					const result: SymbolInformation[] = await this.service.workspaceSymbol({
						symbol: {
							name: 'a',
							kind: 'class',
							package: {
								name: 'mypkg'
							}
						}
					}).toArray().map(patches => apply(null, patches)).toPromise();
					assert.deepEqual(result[0], {
					kind: SymbolKind.Class,
						location: {
							range: {
								end: {
									character: 33,
									line: 0
								},
								start: {
									character: 0,
									line: 0
								}
							},
							uri: rootUri + 'a.ts'
						},
						name: 'a'
					});
				} as any);
				it('should find a symbol by name, kind, package name and ignore package version', async function (this: TestContext) {
					const result: SymbolInformation[] = await this.service.workspaceSymbol({
						symbol: { name: 'a', kind: 'class', package: { name: 'mypkg', version: '203940234' } }
					}).toArray().map(patches => apply(null, patches)).toPromise();
					assert.deepEqual(result[0], {
						kind: SymbolKind.Class,
						location: {
							range: {
								end: {
									character: 33,
									line: 0
								},
								start: {
									character: 0,
									line: 0
								}
							},
							uri: rootUri + 'a.ts'
						},
						name: 'a'
					});
				} as any);
				it('should find a symbol by name', async function (this: TestContext) {
					const result: SymbolInformation[] = await this.service.workspaceSymbol({
						symbol: {
							name: 'a'
						}
					}).toArray().map(patches => apply(null, patches)).toPromise();
					assert.deepEqual(result, [{
						kind: SymbolKind.Class,
						location: {
							range: {
								end: {
									character: 33,
									line: 0
								},
								start: {
									character: 0,
									line: 0
								}
							},
							uri: rootUri + 'a.ts'
						},
						name: 'a'
					}]);
				} as any);
				it('should return no result if the PackageDescriptor does not match', async function (this: TestContext) {
					const result: SymbolInformation[] = await this.service.workspaceSymbol({
						symbol: {
							name: 'a',
							kind: 'class',
							package: {
								name: 'not-mypkg'
							}
						}
					}).toArray().map(patches => apply(null, patches)).toPromise();
					assert.deepEqual(result, []);
				} as any);
			} as any);
			describe('with text query', function (this: TestContext) {
				it('should find a symbol', async function (this: TestContext) {
					const result: SymbolInformation[] = await this.service.workspaceSymbol({ query: 'a' }).toArray().map(patches => apply(null, patches)).toPromise();
					assert.deepEqual(result, [{
						kind: SymbolKind.Class,
						location: {
							range: {
								end: {
									character: 33,
									line: 0
								},
								start: {
									character: 0,
									line: 0
								}
							},
							uri: rootUri + 'a.ts'
						},
						name: 'a'
					}]);
				} as any);
				it('should return all symbols for an empty query excluding dependencies', async function (this: TestContext) {
					const result: SymbolInformation[] = await this.service.workspaceSymbol({ query: '' }).toArray().map(patches => apply(null, patches)).toPromise();
					assert.deepEqual(result, [
						{
							name: 'a',
							kind: SymbolKind.Class,
							location: {
								uri: rootUri + 'a.ts',
								range: {
									start: {
										line: 0,
										character: 0
									},
									end: {
										line: 0,
										character: 33
									}
								}
							}
						},
						{
							name: 'foo',
							kind: SymbolKind.Method,
							location: {
								uri: rootUri + 'a.ts',
								range: {
									start: {
										line: 0,
										character: 10
									},
									end: {
										line: 0,
										character: 31
									}
								}
							},
							containerName: 'a'
						},
						{
							name: 'i',
							kind: SymbolKind.Constant,
							location: {
								uri: rootUri + 'a.ts',
								range: {
									start: {
										line: 0,
										character: 24
									},
									end: {
										line: 0,
										character: 29
									}
								}
							},
							containerName: 'foo'
						},
						{
							name: '"c"',
							kind: SymbolKind.Module,
							location: {
								uri: rootUri + 'c.ts',
								range: {
									start: {
										line: 0,
										character: 0
									},
									end: {
										line: 0,
										character: 28
									}
								}
							}
						},
						{
							name: 'x',
							containerName: '"c"',
							kind: SymbolKind.Variable,
							location: {
								uri: rootUri + 'c.ts',
								range: {
									start: {
										line: 0,
										character: 9
									},
									end: {
										line: 0,
										character: 10
									}
								}
							}
						},
						{
							name: 'b',
							kind: SymbolKind.Class,
							location: {
								uri: rootUri + 'foo/b.ts',
								range: {
									start: {
										line: 0,
										character: 0
									},
									end: {
										line: 0,
										character: 57
									}
								}
							}
						},
						{
							name: 'bar',
							kind: SymbolKind.Property,
							location: {
								uri: rootUri + 'foo/b.ts',
								range: {
									start: {
										line: 0,
										character: 10
									},
									end: {
										line: 0,
										character: 22
									}
								}
							},
							containerName: 'b'
						},
						{
							name: 'baz',
							kind: SymbolKind.Method,
							location: {
								uri: rootUri + 'foo/b.ts',
								range: {
									start: {
										line: 0,
										character: 23
									},
									end: {
										line: 0,
										character: 56
									}
								}
							},
							containerName: 'b'
						},
						{
							name: 'qux',
							kind: SymbolKind.Function,
							location: {
								uri: rootUri + 'foo/b.ts',
								range: {
									start: {
										line: 0,
										character: 59
									},
									end: {
										line: 0,
										character: 76
									}
								}
							}
						}
					]);
				} as any);
			} as any);
		} as any);

		describe('workspaceXreferences()', function (this: TestContext) {
			it('should return all references to a method', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: { name: 'foo', kind: 'method', containerName: 'a' } }).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					symbol: {
						filePath: 'a.ts',
						containerKind: '',
						containerName: 'a',
						name: 'foo',
						kind: 'method'
					},
					reference: {
						range: {
							end: {
								character: 13,
								line: 0
							},
							start: {
								character: 10,
								line: 0
							}
						},
						uri: rootUri + 'a.ts'
					}
				}]);
			} as any);
			it('should return all references to a method with hinted dependee package name', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: { name: 'foo', kind: 'method', containerName: 'a' }, hints: { dependeePackageName: 'mypkg' } }).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					symbol: {
						filePath: 'a.ts',
						containerKind: '',
						containerName: 'a',
						name: 'foo',
						kind: 'method'
					},
					reference: {
						range: {
							end: {
								character: 13,
								line: 0
							},
							start: {
								character: 10,
								line: 0
							}
						},
						uri: rootUri + 'a.ts'
					}
				}]);
			} as any);
			it('should return no references to a method if hinted dependee package name was not found', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: { name: 'foo', kind: 'method', containerName: 'a' }, hints: { dependeePackageName: 'NOT-mypkg' } }).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, []);
			} as any);
			it('should return all references to a symbol from a dependency', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: { name: 'x', containerName: '' } }).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					reference: {
						range: {
							end: {
								character: 10,
								line: 0
							},
							start: {
								character: 9,
								line: 0
							}
						},
						uri: rootUri + 'c.ts'
					},
					symbol: {
						filePath: 'node_modules/dep/dep.ts',
						containerKind: '',
						containerName: '"node_modules/dep/dep"',
						kind: 'var',
						name: 'x'
					}
				}]);
			} as any);
			it('should return all references to all symbols if empty SymbolDescriptor query is passed', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: {} }).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [
					{
						symbol: {
							filePath: 'a.ts',
							containerName: '"a"',
							containerKind: 'module',
							kind: 'class',
							name: 'a'
						},
						reference: {
							range: {
								end: {
									character: 7,
									line: 0
								},
								start: {
									character: 6,
									line: 0
								}
							},
							uri: rootUri + 'a.ts'
						}
					},
					{
						symbol: {
							filePath: 'a.ts',
							containerName: 'a',
							containerKind: '',
							name: 'foo',
							kind: 'method'
						},
						reference: {
							range: {
								end: {
									character: 13,
									line: 0
								},
								start: {
									character: 10,
									line: 0
								}
							},
							uri: rootUri + 'a.ts'
						}
					},
					{
						symbol: {
							filePath: 'a.ts',
							containerName: '"a"',
							containerKind: 'module',
							name: 'i',
							kind: 'const'
						},
						reference: {
							range: {
								end: {
									character: 25,
									line: 0
								},
								start: {
									character: 24,
									line: 0
								}
							},
							uri: rootUri + 'a.ts'
						}
					},
					{
						reference: {
							range: {
								end: {
									character: 10,
									line: 0
								},
								start: {
									character: 9,
									line: 0
								}
							},
							uri: rootUri + 'c.ts'
						},
						symbol: {
							filePath: 'node_modules/dep/dep.ts',
							containerKind: '',
							containerName: '"node_modules/dep/dep"',
							kind: 'var',
							name: 'x'
						}
					},
					{
						symbol: {
							filePath: 'foo/b.ts',
							containerName: '"foo/b"',
							containerKind: 'module',
							name: 'b',
							kind: 'class'
						},
						reference: {
							range: {
								end: {
									character: 7,
									line: 0
								},
								start: {
									character: 6,
									line: 0
								}
							},
							uri: rootUri + 'foo/b.ts'
						}
					},
					{
						symbol: {
							filePath: 'foo/b.ts',
							containerName: 'b',
							containerKind: '',
							name: 'bar',
							kind: 'property'
						},
						reference: {
							range: {
								end: {
									character: 13,
									line: 0
								},
								start: {
									character: 10,
									line: 0
								}
							},
							uri: rootUri + 'foo/b.ts'
						}
					},
					{
						symbol: {
							filePath: 'foo/b.ts',
							containerName: 'b',
							containerKind: '',
							name: 'baz',
							kind: 'method'
						},
						reference: {
							range: {
								end: {
									character: 26,
									line: 0
								},
								start: {
									character: 23,
									line: 0
								}
							},
							uri: rootUri + 'foo/b.ts'
						}
					},
					{
						symbol: {
							filePath: 'foo/b.ts',
							containerName: 'b',
							containerKind: '',
							name: 'bar',
							kind: 'property'
						},
						reference: {
							range: {
								end: {
									character: 54,
									line: 0
								},
								start: {
									character: 52,
									line: 0
								}
							},
							uri: rootUri + 'foo/b.ts'
						}
					},
					{
						symbol: {
							filePath: 'foo/b.ts',
							containerName: '"foo/b"',
							containerKind: 'module',
							name: 'qux',
							kind: 'function'
						},
						reference: {
							range: {
								end: {
									character: 71,
									line: 0
								},
								start: {
									character: 68,
									line: 0
								}
							},
							uri: rootUri + 'foo/b.ts'
						}
					}
				]);
			} as any);
		} as any);
	} as any);

	describe('Dependency detection', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'package.json', JSON.stringify({
				name: 'tslint',
				version: '4.0.2',
				dependencies: {
					'babel-code-frame': '^6.16.0',
					'findup-sync': '~0.3.0'
				},
				devDependencies: {
					'@types/babel-code-frame': '^6.16.0',
					'@types/optimist': '0.0.29',
					'chai': '^3.0.0',
					'tslint': 'latest',
					'tslint-test-config-non-relative': 'file:test/external/tslint-test-config-non-relative',
					'typescript': '2.0.10'
				},
				peerDependencies: {
					typescript: '>=2.0.0'
				}
			})],
			[rootUri + 'node_modules/dep/package.json', JSON.stringify({
				name: 'foo',
				dependencies: {
					shouldnotinclude: '0.0.0'
				}
			})],
			[rootUri + 'subproject/package.json', JSON.stringify({
				name: 'subproject',
				repository: {
					url: 'https://github.com/my/subproject'
				},
				dependencies: {
					'subproject-dep': '0.0.0'
				}
			})]
		])) as any);

		afterEach(shutdownService as any);

		describe('workspaceXdependencies()', function (this: TestContext) {
			it('should account for all dependencies', async function (this: TestContext) {
				const result = await this.service.workspaceXdependencies().toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [
					{ attributes: { name: 'babel-code-frame', version: '^6.16.0' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: 'findup-sync', version: '~0.3.0' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: '@types/babel-code-frame', version: '^6.16.0' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: '@types/optimist', version: '0.0.29' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: 'chai', version: '^3.0.0' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: 'tslint', version: 'latest' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: 'tslint-test-config-non-relative', version: 'file:test/external/tslint-test-config-non-relative' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: 'typescript', version: '2.0.10' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: 'typescript', version: '>=2.0.0' }, hints: { dependeePackageName: 'tslint' } },
					{ attributes: { name: 'subproject-dep', version: '0.0.0' }, hints: { dependeePackageName: 'subproject' } }
				]);
			} as any);
		} as any);
		describe('workspaceXpackages()', function (this: TestContext) {
			it('should accournt for all packages', async function (this: TestContext) {
				const result = await this.service.workspaceXpackages().toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					package: {
						name: 'tslint',
						version: '4.0.2',
						repoURL: undefined
					},
					dependencies: [
						{ attributes: { name: 'babel-code-frame', version: '^6.16.0' }, hints: { dependeePackageName: 'tslint' } },
						{ attributes: { name: 'findup-sync', version: '~0.3.0' }, hints: { dependeePackageName: 'tslint' } },
						{ attributes: { name: '@types/babel-code-frame', version: '^6.16.0' }, hints: { dependeePackageName: 'tslint' } },
						{ attributes: { name: '@types/optimist', version: '0.0.29' }, hints: { dependeePackageName: 'tslint' } },
						{ attributes: { name: 'chai', version: '^3.0.0' }, hints: { dependeePackageName: 'tslint' } },
						{ attributes: { name: 'tslint', version: 'latest' }, hints: { dependeePackageName: 'tslint' } },
						{ attributes: { name: 'tslint-test-config-non-relative', version: 'file:test/external/tslint-test-config-non-relative' }, hints: { dependeePackageName: 'tslint' } },
						{ attributes: { name: 'typescript', version: '2.0.10' }, hints: { dependeePackageName: 'tslint' } },
						{ attributes: { name: 'typescript', version: '>=2.0.0' }, hints: { dependeePackageName: 'tslint' } }
					]
				}, {
					package: {
						name: 'subproject',
						version: undefined,
						repoURL: 'https://github.com/my/subproject'
					},
					dependencies: [
						{ attributes: { name: 'subproject-dep', version: '0.0.0' }, hints: { dependeePackageName: 'subproject' } }
					]
				}]);
			} as any);
		} as any);
	} as any);

	describe('TypeScript library', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'a.ts', 'let parameters = [];']
		])) as any);

		afterEach(shutdownService as any);

		specify('type of parameters should be any[]', async function (this: TestContext) {
			const result: Hover = await this.service.textDocumentHover({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				position: {
					line: 0,
					character: 5
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
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
				contents: [
					{ language: 'typescript', value: 'let parameters: any[]' },
					'**let**'
				]
			});
		} as any);
	} as any);

	describe('Live updates', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'a.ts', 'let parameters = [];']
		])) as any);

		afterEach(shutdownService as any);

		it('should handle didChange when configuration is not yet initialized', async function (this: TestContext) {

			const hoverParams = {
				textDocument: {
					uri: rootUri + 'a.ts'
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

			await this.service.textDocumentDidChange({
				textDocument: {
					uri: rootUri + 'a.ts',
					version: 1
				},
				contentChanges: [{
					text: 'let parameters: number[]'
				}]
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams).toArray().map(patches => apply(null, patches)).toPromise(), {
				range,
				contents: [
					{ language: 'typescript', value: 'let parameters: number[]' },
					'**let**'
				]
			});
		} as any);

		it('should handle didClose when configuration is not yet initialized', async function (this: TestContext) {

			const hoverParams = {
				textDocument: {
					uri: rootUri + 'a.ts'
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

			await this.service.textDocumentDidClose({
				textDocument: {
					uri: rootUri + 'a.ts'
				}
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams).toArray().map(patches => apply(null, patches)).toPromise(), {
				range,
				contents: [
					{ language: 'typescript', value: 'let parameters: any[]' },
					'**let**'
				]
			});
		} as any);

		it('should reflect updated content', async function (this: TestContext) {

			const hoverParams = {
				textDocument: {
					uri: rootUri + 'a.ts'
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

			assert.deepEqual(await this.service.textDocumentHover(hoverParams).toArray().map(patches => apply(null, patches)).toPromise(), {
				range,
				contents: [
					{ language: 'typescript', value: 'let parameters: any[]' },
					'**let**'
				]
			});

			await this.service.textDocumentDidOpen({
				textDocument: {
					uri: rootUri + 'a.ts',
					languageId: 'typescript',
					version: 1,
					text: 'let parameters: string[]'
				}
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams).toArray().map(patches => apply(null, patches)).toPromise(), {
				range,
				contents: [
					{ language: 'typescript', value: 'let parameters: string[]' },
					'**let**'
				]
			});

			await this.service.textDocumentDidChange({
				textDocument: {
					uri: rootUri + 'a.ts',
					version: 2
				},
				contentChanges: [{
					text: 'let parameters: number[]'
				}]
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams).toArray().map(patches => apply(null, patches)).toPromise(), {
				range,
				contents: [
					{ language: 'typescript', value: 'let parameters: number[]' },
					'**let**'
				]
			});

			await this.service.textDocumentDidClose({
				textDocument: {
					uri: rootUri + 'a.ts'
				}
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams).toArray().map(patches => apply(null, patches)).toPromise(), {
				range,
				contents: [
					{ language: 'typescript', value: 'let parameters: any[]' },
					'**let**'
				]
			});
		} as any);
	} as any);

	describe('Diagnostics', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'src/errors.ts', 'const text: string = 33;']
		])) as any);

		afterEach(shutdownService as any);

		it('should publish diagnostics on didOpen', async function (this: TestContext) {

			await this.service.textDocumentDidOpen({
				textDocument: {
					uri: rootUri + 'src/errors.ts',
					languageId: 'typescript',
					text: 'const text: string = 33;',
					version: 1
				}
			});

			sinon.assert.calledOnce(this.client.textDocumentPublishDiagnostics);
			sinon.assert.calledWithExactly(this.client.textDocumentPublishDiagnostics, {
				diagnostics: [{
					message: "Type '33' is not assignable to type 'string'.",
					range: { end: { character: 10, line: 0 }, start: { character: 6, line: 0 } },
					severity: 1,
					source: 'ts',
					code: 2322
				}],
				uri: rootUri + 'src/errors.ts'
			});
		} as any);

		it('should publish diagnostics on didChange', async function (this: TestContext) {

			await this.service.textDocumentDidOpen({
				textDocument: {
					uri: rootUri + 'src/errors.ts',
					languageId: 'typescript',
					text: 'const text: string = 33;',
					version: 1
				}
			});

			this.client.textDocumentPublishDiagnostics.resetHistory();

			await this.service.textDocumentDidChange({
				textDocument: {
					uri: rootUri + 'src/errors.ts',
					version: 2
				},
				contentChanges: [
					{ text: 'const text: boolean = 33;' }
				]
			});

			sinon.assert.calledOnce(this.client.textDocumentPublishDiagnostics);
			sinon.assert.calledWithExactly(this.client.textDocumentPublishDiagnostics, {
				diagnostics: [{
					message: "Type '33' is not assignable to type 'boolean'.",
					range: { end: { character: 10, line: 0 }, start: { character: 6, line: 0 } },
					severity: 1,
					source: 'ts',
					code: 2322
				}],
				uri: rootUri + 'src/errors.ts'
			});
		} as any);

		it('should publish empty diagnostics on didChange if error was fixed', async function (this: TestContext) {

			await this.service.textDocumentDidOpen({
				textDocument: {
					uri: rootUri + 'src/errors.ts',
					languageId: 'typescript',
					text: 'const text: string = 33;',
					version: 1
				}
			});

			this.client.textDocumentPublishDiagnostics.resetHistory();

			await this.service.textDocumentDidChange({
				textDocument: {
					uri: rootUri + 'src/errors.ts',
					version: 2
				},
				contentChanges: [
					{ text: 'const text: number = 33;' }
				]
			});

			sinon.assert.calledOnce(this.client.textDocumentPublishDiagnostics);
			sinon.assert.calledWithExactly(this.client.textDocumentPublishDiagnostics, {
				diagnostics: [],
				uri: rootUri + 'src/errors.ts'
			});
		} as any);

		it('should clear diagnostics on didClose', async function (this: TestContext) {

			await this.service.textDocumentDidClose({
				textDocument: {
					uri: rootUri + 'src/errors.ts'
				}
			});

			sinon.assert.calledOnce(this.client.textDocumentPublishDiagnostics);
			sinon.assert.calledWithExactly(this.client.textDocumentPublishDiagnostics, {
				diagnostics: [],
				uri: rootUri + 'src/errors.ts'
			});
		} as any);

	} as any);

	describe('References and imports', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'a.ts', '/// <reference path="b.ts"/>\nnamespace qux {let f : foo;}'],
			[rootUri + 'b.ts', '/// <reference path="foo/c.ts"/>'],
			[rootUri + 'c.ts', 'import * as d from "./foo/d"\nd.bar()'],
			[rootUri + 'foo/c.ts', 'namespace qux {export interface foo {}}'],
			[rootUri + 'foo/d.ts', 'export function bar() {}'],
			[rootUri + 'deeprefs/a.ts', '/// <reference path="b.ts"/>\nnamespace qux {\nlet f : foo;\n}'],
			[rootUri + 'deeprefs/b.ts', '/// <reference path="c.ts"/>'],
			[rootUri + 'deeprefs/c.ts', '/// <reference path="d.ts"/>'],
			[rootUri + 'deeprefs/d.ts', '/// <reference path="e.ts"/>'],
			[rootUri + 'deeprefs/e.ts', 'namespace qux {\nexport interface foo {}\n}'],
			[rootUri + 'missing/a.ts', '/// <reference path="b.ts"/>\n/// <reference path="missing.ts"/>\nnamespace t {\n    function foo() : Bar {\n        return null;\n    }\n}'],
			[rootUri + 'missing/b.ts', 'namespace t {\n    export interface Bar {\n        id?: number;\n    }}']
		])) as any);

		afterEach(shutdownService as any);

		describe('textDocumentDefinition()', function (this: TestContext) {
			it('should resolve symbol imported with tripe-slash reference', async function (this: TestContext) {
				const result: Location[] = await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 1,
						character: 23
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					// Note: technically this list should also
					// include the 2nd definition of `foo` in
					// deeprefs/e.ts, but there's no easy way to
					// discover it through file-level imports and
					// it is rare enough that we accept this
					// omission. (It would probably show up in the
					// definition response if the user has already
					// navigated to deeprefs/e.ts.)
					uri: rootUri + 'foo/c.ts',
					range: {
						start: {
							line: 0,
							character: 32
						},
						end: {
							line: 0,
							character: 35
						}
					}
				}]);
			} as any);
			it('should resolve symbol imported with import statement', async function (this: TestContext) {
				const result: Location[] = await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'c.ts'
					},
					position: {
						line: 1,
						character: 2
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					uri: rootUri + 'foo/d.ts',
					range: {
						start: {
							line: 0,
							character: 16
						},
						end: {
							line: 0,
							character: 19
						}
					}
				}]);
			} as any);
			it('should resolve definition with missing reference', async function (this: TestContext) {
				const result: Location[] = await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'missing/a.ts'
					},
					position: {
						line: 3,
						character: 21
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					uri: rootUri + 'missing/b.ts',
					range: {
						start: {
							line: 1,
							character: 21
						},
						end: {
							line: 1,
							character: 24
						}
					}
				}]);
			} as any);
			it('should resolve deep definitions', async function (this: TestContext) {
				// This test passes only because we expect no response from LSP server
				// for definition located in file references with depth 3 or more (a -> b -> c -> d (...))
				// This test will fail once we'll increase (or remove) depth limit
				const result: Location[] = await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'deeprefs/a.ts'
					},
					position: {
						line: 2,
						character: 8
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
				assert.deepEqual(result, [{
					uri: rootUri + 'deeprefs/e.ts',
					range: {
						start: {
							line: 1,
							character: 17
						},
						end: {
							line: 1,
							character: 20
						}
					}
				}]);
			} as any);
		} as any);
	} as any);

	describe('TypeScript libraries', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
				[rootUri + 'tsconfig.json', JSON.stringify({
					compilerOptions: {
						lib: ['es2016', 'dom']
					}
				})],
				[rootUri + 'a.ts', 'function foo(n: Node): {console.log(n.parentNode, NaN})}']
		])) as any);

		afterEach(shutdownService as any);

		describe('textDocumentHover()', function (this: TestContext) {
			it('should load local library file', async function (this: TestContext) {
				const result: Hover = await this.service.textDocumentHover({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 16
					}
				}).toArray().map(patches => apply(null, patches)).toPromise();
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
					contents: [
						{
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
						},
						'**var** _(ambient)_'
					]
				});
			} as any);
			} as any);
		describe('textDocumentDefinition()', function (this: TestContext) {
			it('should resolve TS libraries to github URL', async function (this: TestContext) {
				assert.deepEqual(await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 16
					}
				}).toArray().map(patches => apply(null, patches)).toPromise(), [{
					uri: 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/lib.dom.d.ts',
					range: {
						start: {
							line: 8258,
							character: 10
						},
						end: {
							line: 8258,
							character: 14
						}
					}
				}, {
					uri: 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/lib.dom.d.ts',
					range: {
						start: {
							line: 8310,
							character: 12
						},
						end: {
							line: 8310,
							character: 16
						}
					}
				}]);

				assert.deepEqual(await this.service.textDocumentDefinition({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 50
					}
				}).toArray().map(patches => apply(null, patches)).toPromise(), [{
					uri: 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/lib.es5.d.ts',
					range: {
						start: {
							line: 24,
							character: 14
						},
						end: {
							line: 24,
							character: 17
						}
					}
				}]);
			} as any);
		} as any);
	} as any);

	describe('textDocumentReferences()', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'a.ts', [
				'class A {',
				'	/** foo doc*/',
				'    foo() {}',
				'	/** bar doc*/',
				'    bar(): number { return 1; }',
				'	/** ',
				'     * The Baz function',
				'     * @param num Number parameter',
				'     * @param text Text parameter',
				'	  */',
				'    baz(num: number, text: string): string { return ""; }',
				'	/** qux doc*/',
				'    qux: number;',
				'}',
				'const a = new A();',
				'a.baz(32, sd)'
			].join('\n')],
			[rootUri + 'uses-import.ts', [
				'import * as i from "./import"',
				'i.d()'
			].join('\n')],
			[rootUri + 'also-uses-import.ts', [
				'import {d} from "./import"',
				'd()'
			].join('\n')],
			[rootUri + 'import.ts', '/** d doc*/ export function d() {}']
		])) as any);

		afterEach(shutdownService as any);

		it('should provide an empty response when no reference is found', async function (this: TestContext) {
			const result = await this.service.textDocumentReferences({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				position: {
					line: 0,
					character: 0
				},
				context: { includeDeclaration: false }
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, []);
		} as any);

		it('should include the declaration if requested', async function (this: TestContext) {
			const result = await this.service.textDocumentReferences({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				position: {
					line: 4,
					character: 5
				},
				context: { includeDeclaration: true }
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, [{
				range: {
					end: {
						character: 7,
						line: 4
					},
					start: {
						character: 4,
						line: 4
					}
				},
				uri: rootUri + 'a.ts'
			}]);
		} as any);

		it('should provide a reference within the same file', async function (this: TestContext) {
			const result = await this.service.textDocumentReferences({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				position: {
					line: 10,
					character: 5
				},
				context: { includeDeclaration: false }
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, [{
				range: {
					end: {
						character: 5,
						line: 15
					},
					start: {
						character: 2,
						line: 15
					}
				},
				uri: rootUri + 'a.ts'
			}]);
		} as any);
		it('should provide two references from imports', async function (this: TestContext) {
			const result = await this.service.textDocumentReferences({
				textDocument: {
					uri: rootUri + 'import.ts'
				},
				position: {
					line: 0,
					character: 28
				},
				context: { includeDeclaration: false }
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, [
				{
					range: {
						end: {
							character: 3,
							line: 1
						},
						start: {
							character: 2,
							line: 1
						}
					},
					uri: rootUri + 'uses-import.ts'
				},
				{
					range: {
						end: {
							character: 1,
							line: 1
						},
						start: {
							character: 0,
							line: 1
						}
					},
					uri: rootUri + 'also-uses-import.ts'
				}
			]);
		} as any);
	} as any);

	describe('textDocumentSignatureHelp()', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'a.ts', [
				'class A {',
				'	/** foo doc*/',
				'    foo() {}',
				'	/** bar doc*/',
				'    bar(): number { return 1; }',
				'	/** ',
				'     * The Baz function',
				'     * @param num Number parameter',
				'     * @param text Text parameter',
				'	  */',
				'    baz(num: number, text: string): string { return ""; }',
				'	/** qux doc*/',
				'    qux: number;',
				'}',
				'const a = new A();',
				'a.baz(32, sd)'
			].join('\n')],
			[rootUri + 'uses-import.ts', [
				'import * as i from "./import"',
				'i.d()'
			].join('\n')],
			[rootUri + 'import.ts', '/** d doc*/ export function d() {}'],
			[rootUri + 'uses-reference.ts', [
				'/// <reference path="reference.ts" />',
				'let z : foo.'
			].join('\n')],
			[rootUri + 'reference.ts', [
				'namespace foo {',
				'	/** bar doc*/',
				'	export interface bar {}',
				'}'
			].join('\n')],
			[rootUri + 'empty.ts', '']
		])) as any);

		afterEach(shutdownService as any);

		it('should provide a valid empty response when no signature is found', async function (this: TestContext) {
			const result: SignatureHelp = await this.service.textDocumentSignatureHelp({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				position: {
					line: 0,
					character: 0
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, {
				signatures: [],
				activeSignature: 0,
				activeParameter: 0
			});
		} as any);

		it('should provide signature help with parameters in the same file', async function (this: TestContext) {
			const result: SignatureHelp = await this.service.textDocumentSignatureHelp({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				position: {
					line: 15,
					character: 11
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, {
				signatures: [
					{
						label: 'baz(num: number, text: string): string',
						documentation: 'The Baz function',
						parameters: [{
							label: 'num: number',
							documentation: 'Number parameter'
						}, {
							label: 'text: string',
							documentation: 'Text parameter'
						}]
					}
				],
				activeSignature: 0,
				activeParameter: 1
			});
		} as any);

		it('should provide signature help from imported symbols', async function (this: TestContext) {
			const result: SignatureHelp = await this.service.textDocumentSignatureHelp({
				textDocument: {
					uri: rootUri + 'uses-import.ts'
				},
				position: {
					line: 1,
					character: 4
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, {
				activeSignature: 0,
				activeParameter: 0,
				signatures: [{
					label: 'd(): void',
					documentation: 'd doc',
					parameters: []
				}]
			});
		} as any);

	} as any);

	describe('textDocumentCompletion()', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'a.ts', [
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
			[rootUri + 'uses-import.ts', [
				'import * as i from "./import"',
				'i.'
			].join('\n')],
			[rootUri + 'import.ts', '/** d doc*/ export function d() {}'],
			[rootUri + 'uses-reference.ts', [
				'/// <reference path="reference.ts" />',
				'let z : foo.'
			].join('\n')],
			[rootUri + 'reference.ts', [
				'namespace foo {',
				'	/** bar doc*/',
				'	export interface bar {}',
				'}'
			].join('\n')],
			[rootUri + 'empty.ts', '']
		])) as any);

		afterEach(shutdownService as any);

		it('produces completions in the same file', async function (this: TestContext) {
			const result: CompletionList = await this.service.textDocumentCompletion({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				position: {
					line: 11,
					character: 2
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
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
		} as any);
		it('produces completions for imported symbols', async function (this: TestContext) {
			const result: CompletionList = await this.service.textDocumentCompletion({
				textDocument: {
					uri: rootUri + 'uses-import.ts'
				},
				position: {
					line: 1,
					character: 2
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
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
		} as any);
		it('produces completions for referenced symbols', async function (this: TestContext) {
			const result: CompletionList = await this.service.textDocumentCompletion({
				textDocument: {
					uri: rootUri + 'uses-reference.ts'
				},
				position: {
					line: 1,
					character: 13
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
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
		} as any);
		it('produces completions for empty files', async function (this: TestContext & ITestCallbackContext) {
			this.timeout(10000);
			const result: CompletionList = await this.service.textDocumentCompletion({
				textDocument: {
					uri: rootUri + 'empty.ts'
				},
				position: {
					line: 0,
					character: 0
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.notDeepEqual(result.items.length, []);
		});
	} as any);

	describe('textDocumentRename()', function (this: TestContext & ISuiteCallbackContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'package.json', JSON.stringify({ name: 'mypkg' })],
			[rootUri + 'a.ts', [
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
			[rootUri + 'uses-import.ts', [
				'import {d} from "./import"',
				'const x = d();'
			].join('\n')],
			[rootUri + 'import.ts', 'export function d(): number { return 55; }']
		])) as any);

		afterEach(shutdownService as any);

		it('should error on an invalid symbol', async function (this: TestContext & ITestCallbackContext) {
			await assert.isRejected(
				this.service.textDocumentRename({
					textDocument: {
						uri: rootUri + 'a.ts'
					},
					position: {
						line: 0,
						character: 1
					},
					newName: 'asdf'
				}).toArray().map(patches => apply(null, patches)).toPromise(),
				'This symbol cannot be renamed'
			);
		});
		it('should return a correct WorkspaceEdit to rename a class', async function (this: TestContext & ITestCallbackContext) {
			const result: WorkspaceEdit = await this.service.textDocumentRename({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				position: {
					line: 0,
					character: 6
				},
				newName: 'B'
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, {
				changes: {
					[rootUri + 'a.ts']: [{
						newText: 'B',
						range: {
							end: {
								character: 7,
								line: 0
							},
							start: {
								character: 6,
								line: 0
							}
						}
					}, {
						newText: 'B',
						range: {
							end: {
								character: 15,
								line: 10
							},
							start: {
								character: 14,
								line: 10
							}
						}
					}]
				}
			});
		});
		it('should return a correct WorkspaceEdit to rename an imported function', async function (this: TestContext & ITestCallbackContext) {
			const result: WorkspaceEdit = await this.service.textDocumentRename({
				textDocument: {
					uri: rootUri + 'import.ts'
				},
				position: {
					line: 0,
					character: 16
				},
				newName: 'f'
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, {
				changes: {
					[rootUri + 'import.ts']: [{
						newText: 'f',
						range: {
							end: {
								character: 17,
								line: 0
							},
							start: {
								character: 16,
								line: 0
							}
						}
					}],
					[rootUri + 'uses-import.ts']: [{
						newText: 'f',
						range: {
							end: {
								character: 9,
								line: 0
							},
							start: {
								character: 8,
								line: 0
							}
						}
					}, {
						newText: 'f',
						range: {
							end: {
								character: 11,
								line: 1
							},
							start: {
								character: 10,
								line: 1
							}
						}
					}]
				}
			});
		});
	});

	describe('textDocumentCodeAction()', function (this: TestContext & ISuiteCallbackContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'package.json', JSON.stringify({ name: 'mypkg' })],
			[rootUri + 'a.ts', [
				'class A {',
				'\tconstructor() {',
				'\t\tmissingThis = 33;',
				'\t}',
				'}',
				'const a = new A();'
			].join('\n')]
		])) as any);

		afterEach(shutdownService as any);

		it('suggests a missing this', async function (this: TestContext & ITestCallbackContext) {
			await this.service.textDocumentDidOpen({
				textDocument: {
					uri: rootUri + 'a.ts',
					languageId: 'typescript',
					text: [
						'class A {',
						'\tmissingThis: number;',
						'\tconstructor() {',
						'\t\tmissingThis = 33;',
						'\t}',
						'}',
						'const a = new A();'
					].join('\n'),
					version: 1
				}
			});

			const firstDiagnostic: Diagnostic = {
				range: {
					start: { line: 3, character: 4 },
					end: { line: 3, character: 15 }
				},
				message: 'Cannot find name \'missingThis\'. Did you mean the instance member \'this.missingThis\'?',
				severity: DiagnosticSeverity.Error,
				code: 2663,
				source: 'ts'
			};
			const actions: Command[] = await this.service.textDocumentCodeAction({
				textDocument: {
					uri: rootUri + 'a.ts'
				},
				range: firstDiagnostic.range,
				context: {
					diagnostics: [firstDiagnostic]
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(actions, [{
				title: 'Add \'this.\' to unresolved variable.',
				command: 'codeFix',
				arguments: [{
					fileName: uri2path(rootUri + 'a.ts'),
					textChanges: [{
						span: { start: 49, length: 13 },
						newText: '\t\tthis.missingThis'
					}]
				}]
			}]);

		});
	});

	describe('workspaceExecuteCommand()', function (this: TestContext & ISuiteCallbackContext) {
		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'package.json', JSON.stringify({ name: 'mypkg' })],
			[rootUri + 'a.ts', [
				'class A {',
				'  constructor() {',
				'    missingThis = 33;',
				'  }',
				'}',
				'const a = new A();'
			].join('\n')]
		])) as any);

		afterEach(shutdownService as any);

		describe('codeFix', () => {
			it('should apply a WorkspaceEdit for the passed FileTextChanges', async function (this: TestContext & ITestCallbackContext) {
				await this.service.workspaceExecuteCommand({
					command: 'codeFix',
					arguments: [{
						fileName: uri2path(rootUri + 'a.ts'),
						textChanges: [{
							span: { start: 50, length: 15 },
							newText: '\t\tthis.missingThis'
						}]
					}]
				}).toArray().map(patches => apply(null, patches)).toPromise();

				sinon.assert.calledOnce(this.client.workspaceApplyEdit);
				const workspaceEdit = this.client.workspaceApplyEdit.lastCall.args[0];
				assert.deepEqual(workspaceEdit, {
					edit: {
						changes: {
							[rootUri + 'a.ts']: [{
								newText: '\t\tthis.missingThis',
								range: {
									end: {
										character: 9,
										line: 5
									},
									start: {
										character: 0,
										line: 3
									}
								}
							}]
						}
					}
				});
			});
		});
	});

	describe('Special file names', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, rootUri, new Map([
			[rootUri + 'keywords-in-path/class/constructor/a.ts', 'export function a() {}'],
			[rootUri + 'special-characters-in-path/%40foo/b.ts', 'export function b() {}'],
			[rootUri + 'windows/app/master.ts', '/// <reference path="..\\lib\\master.ts" />\nc();'],
			[rootUri + 'windows/lib/master.ts', '/// <reference path="..\\lib\\slave.ts" />'],
			[rootUri + 'windows/lib/slave.ts', 'function c() {}']
		])) as any);

		afterEach(shutdownService as any);

		it('should accept files with TypeScript keywords in path', async function (this: TestContext) {
			const result: Hover = await this.service.textDocumentHover({
				textDocument: {
					uri: rootUri + 'keywords-in-path/class/constructor/a.ts'
				},
				position: {
					line: 0,
					character: 16
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, {
				range: {
					start: {
						line: 0,
						character: 16
					},
					end: {
						line: 0,
						character: 17
					}
				},
				contents: [
					{ language: 'typescript', value: 'function a(): void' },
					'**function** _(exported)_'
				]
			});
		} as any);
		it('should accept files with special characters in path', async function (this: TestContext) {
			const result: Hover = await this.service.textDocumentHover({
				textDocument: {
					uri: rootUri + 'special-characters-in-path/%40foo/b.ts'
				},
				position: {
					line: 0,
					character: 16
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, {
				range: {
					start: {
						line: 0,
						character: 16
					},
					end: {
						line: 0,
						character: 17
					}
				},
				contents: [
					{ language: 'typescript', value: 'function b(): void' },
					'**function** _(exported)_'
				]
			});
		} as any);
		it('should handle Windows-style paths in triple slash references', async function (this: TestContext) {
			const result = await this.service.textDocumentDefinition({
				textDocument: {
					uri: rootUri + 'windows/app/master.ts'
				},
				position: {
					line: 1,
					character: 0
				}
			}).toArray().map(patches => apply(null, patches)).toPromise();
			assert.deepEqual(result, [{
				range: {
					start: {
						line: 0,
						character: 9
					},
					end: {
						line: 0,
						character: 10
					}
				},
				uri: rootUri + 'windows/lib/slave.ts'
			}]);
		} as any);
	} as any);
}
