import * as chai from 'chai';
import * as ts from 'typescript';
import { CompletionItemKind, LogMessageParams, TextDocumentIdentifier, TextDocumentItem } from 'vscode-languageserver';
import { SymbolKind } from 'vscode-languageserver-types';
import { CacheGetParams, CacheSetParams, TextDocumentContentParams, WorkspaceFilesParams } from '../request-type';
import { TypeScriptService, TypeScriptServiceFactory } from '../typescript-service';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;

/**
 * Enforcing strict mode to make tests pass on Windows
 */
import { setStrict } from '../util';
setStrict(true);

export interface TestContext {

	/** TypeScript service under test */
	service: TypeScriptService;
}

/**
 * Returns a function that initializes the test context with a TypeScriptService instance and initializes it (to be used in `beforeEach`)
 *
 * @param createService A factory that creates the TypeScript service. Allows to test subclasses of TypeScriptService
 * @param files A Map from URI to file content of files that should be available in the workspace
 */
export const initializeTypeScriptService = (createService: TypeScriptServiceFactory, files: Map<string, string>) => async function (this: TestContext): Promise<void> {
	this.service = createService({
		textDocumentXcontent(params: TextDocumentContentParams): Promise<TextDocumentItem> {
			if (!files.has(params.textDocument.uri)) {
				return Promise.reject(new Error(`Text document ${params.textDocument.uri} does not exist`));
			}
			return Promise.resolve({
				uri: params.textDocument.uri,
				text: files.get(params.textDocument.uri),
				version: 1,
				languageId: ''
			} as TextDocumentItem);
		},
		workspaceXfiles(params: WorkspaceFilesParams): Promise<TextDocumentIdentifier[]> {
			return Promise.resolve(Array.from(files.keys()).map(uri => ({ uri })));
		},
		windowLogMessage(params: LogMessageParams): void {
			// noop
		},
		xcacheGet(params: CacheGetParams): any {
			return Promise.resolve(null);
		},
		xcacheSet(params: CacheSetParams): any {
			// noop
		}
	});
	await this.service.initialize({
		processId: process.pid,
		rootUri: 'file:///',
		capabilities: {
			xcontentProvider: true,
			xfilesProvider: true
		}
	});
};

/**
 * Shuts the TypeScriptService down (to be used in `afterEach()`)
 */
export async function shutdownTypeScriptService(this: TestContext): Promise<void> {
	await this.service.shutdown();
}

/**
 * Describe a TypeScriptService class
 *
 * @param createService Factory function to create the TypeScriptService instance to describe
 */
export function describeTypeScriptService(createService: TypeScriptServiceFactory, shutdownService = shutdownTypeScriptService) {

	describe('Workspace without project files', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, new Map([
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
			].join('\n')]
		])) as any);

		afterEach(shutdownService as any);

		describe('textDocumentDefinition()', function (this: TestContext) {
			specify('in same file', async function (this: TestContext) {
				const result = await this.service.textDocumentDefinition({
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
							character: 9
						}
					}
				}]);
			} as any);
			specify('on keyword (non-null)', async function (this: TestContext) {
				const result = await this.service.textDocumentDefinition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				});
				assert.deepEqual(result, []);
			} as any);
			specify('in other file', async function (this: TestContext) {
				const result = await this.service.textDocumentDefinition({
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
				const result = await this.service.textDocumentXdefinition({
					textDocument: {
						uri: 'file:///e.ts'
					},
					position: {
						line: 3,
						character: 15
					}
				}).toPromise();
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
								character: 8
							}
						}
					},
					symbol: {
						containerName: 'I',
						containerKind: '',
						kind: 'property',
						name: 'target'
					}
				}]);
			} as any);
			specify('in same file', async function (this: TestContext) {
				const result = await this.service.textDocumentXdefinition({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 29
					}
				}).toPromise();
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
								character: 9
							}
						}
					},
					symbol: {
						containerName: '',
						containerKind: '',
						kind: 'const',
						name: 'abc'
					}
				}]);
			} as any);
		} as any);
		describe('textDocumentHover()', function (this: TestContext) {
			specify('in same file', async function (this: TestContext) {
				const result = await this.service.textDocumentHover({
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
			} as any);
			specify('in other file', async function (this: TestContext) {
				const result = await this.service.textDocumentHover({
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
			} as any);
			specify('over keyword (non-null)', async function (this: TestContext) {
				const result = await this.service.textDocumentHover({
					textDocument: {
						uri: 'file:///a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				});
				assert.deepEqual(result, { contents: [] });
			} as any);
			specify('over non-existent file', function (this: TestContext) {
				return assert.isRejected(this.service.textDocumentHover({
					textDocument: {
						uri: 'file:///foo/a.ts'
					},
					position: {
						line: 0,
						character: 0
					}
				}));
			} as any);
		} as any);
	} as any);

	describe('Workspace with typings directory', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///src/a.ts', "import * as m from 'dep';"],
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
				'}'
			].join('\n')],
			['file:///src/tsd.d.ts', '/// <reference path="../typings/dep.d.ts" />'],
			['file:///src/dir/index.ts', 'import * as m from "dep";']
		])) as any);

		afterEach(shutdownService as any);

		describe('textDocumentDefinition()', function (this: TestContext) {
			specify('with tsd.d.ts', async function (this: TestContext) {
				const result = await this.service.textDocumentDefinition({
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
					const result = await this.service.textDocumentDefinition({
						textDocument: {
							uri: 'file:///src/a.ts'
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
					const result = await this.service.textDocumentDefinition({
						textDocument: {
							uri: 'file:///src/a.ts'
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

	describe('Global module', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///a.ts', 'const rt: GQL.Rt;'],
			['file:///interfaces.d.ts', 'declare namespace GQL { interface Rt { } }']
		])) as any);

		afterEach(shutdownService as any);

		specify('textDocumentDefinition()', async function (this: TestContext) {
			const result = await this.service.textDocumentDefinition({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 14
				}
			});
			assert.deepEqual(result, [{
				uri: 'file:///interfaces.d.ts',
				range: {
					start: {
						line: 0,
						character: 34
					},
					end: {
						line: 0,
						character: 36
					}
				}
			}]);
		} as any);
	} as any);

	describe('DefinitelyTyped', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///package.json', JSON.stringify({
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
		])) as any);

		afterEach(shutdownService as any);

		describe('workspaceSymbol()', function (this: TestContext) {
			specify('resolve, with package', async function (this: TestContext) {
				const result = await this.service.workspaceSymbol({
					symbol: { name: 'resolveCallback', package: { name: '@types/resolve' } },
					limit: 10
				});
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
						uri: 'file:///resolve/index.d.ts'
					},
					name: 'resolveCallback'
				}]);
			} as any);
			specify('resolve, with package, empty containerKind', async function (this: TestContext) {
				const result = await this.service.workspaceSymbol({
					symbol: { name: 'resolveCallback', containerKind: '', package: { name: '@types/resolve' } },
					limit: 10
				});
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
						uri: 'file:///resolve/index.d.ts'
					},
					name: 'resolveCallback'
				}]);
			} as any);
		} as any);
	} as any);

	describe('Workspace with root package.json', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///a.ts', 'class a { foo() { const i = 1;} }'],
			['file:///foo/b.ts', 'class b { bar: number; baz(): number { return this.bar;}}; function qux() {}'],
			['file:///c.ts', 'import { x } from "dep/dep";'],
			['file:///package.json', '{ "name": "mypkg" }'],
			['file:///node_modules/dep/dep.ts', 'export var x = 1;']
		])) as any);

		afterEach(shutdownService as any);

		describe('workspaceSymbol()', function (this: TestContext) {
			describe('symbol query', function (this: TestContext) {
				specify('with package', async function (this: TestContext) {
					const result = await this.service.workspaceSymbol({
						symbol: { name: 'a', kind: 'class', package: { name: 'mypkg' } },
						limit: 10
					});
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
							uri: 'file:///a.ts'
						},
						name: 'a'
					}]);
				} as any);
				specify('with package, with package version (ignored)', async function (this: TestContext) {
					const result = await this.service.workspaceSymbol({
						symbol: { name: 'a', kind: 'class', package: { name: 'mypkg', version: '203940234' } },
						limit: 10
					});
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
							uri: 'file:///a.ts'
						},
						name: 'a'
					}]);
				} as any);
				specify('for a', async function (this: TestContext) {
					const result = await this.service.workspaceSymbol({
						symbol: { name: 'a' },
						limit: 10
					});
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
							uri: 'file:///a.ts'
						},
						name: 'a'
					}]);
				} as any);
			} as any);
			describe('text query', function (this: TestContext) {
				specify('for a', async function (this: TestContext) {
					const result = await this.service.workspaceSymbol({
						query: 'a',
						limit: 10
					});
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
							uri: 'file:///a.ts'
						},
						name: 'a'
					}]);
				} as any);
				specify('with wrong package', async function (this: TestContext) {
					const result = await this.service.workspaceSymbol({
						symbol: { name: 'a', kind: 'class', package: { name: 'not-mypkg' } },
						limit: 10
					});
					assert.deepEqual(result, []);
				} as any);
			} as any);
		} as any);

		describe('workspaceXreferences()', function (this: TestContext) {
			specify('"foo"', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: { name: 'foo', kind: 'method', containerName: 'a' } }).toPromise();
				assert.deepEqual(result, [{
					symbol: {
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
								character: 9,
								line: 0
							}
						},
						uri: 'file:///a.ts'
					}
				}]);
			} as any);
			specify('"foo", with hint', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: { name: 'foo', kind: 'method', containerName: 'a' }, hints: { dependeePackageName: 'mypkg' } }).toPromise();
				assert.deepEqual(result, [{
					symbol: {
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
								character: 9,
								line: 0
							}
						},
						uri: 'file:///a.ts'
					}
				}]);
			} as any);
			specify('"foo", with hint, not found', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: { name: 'foo', kind: 'method', containerName: 'a' }, hints: { dependeePackageName: 'NOT-mypkg' } }).toPromise();
				assert.deepEqual(result, []);
			} as any);
			specify('dependency reference', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: { name: 'x', containerName: '' } }).toPromise();
				assert.deepEqual(result, [{
					reference: {
						range: {
							end: {
								character: 10,
								line: 0
							},
							start: {
								character: 8,
								line: 0
							}
						},
						uri: 'file:///c.ts'
					},
					symbol: {
						containerKind: '',
						containerName: '',
						kind: 'var',
						name: 'x'
					}
				}]);
			} as any);
			specify('all references', async function (this: TestContext) {
				const result = await this.service.workspaceXreferences({ query: {} }).toPromise();
				assert.deepEqual(result, [
					{
						symbol: {
							containerName: '',
							containerKind: '',
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
									character: 5,
									line: 0
								}
							},
							uri: 'file:///a.ts'
						}
					},
					{
						symbol: {
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
									character: 9,
									line: 0
								}
							},
							uri: 'file:///a.ts'
						}
					},
					{
						symbol: {
							containerName: '',
							containerKind: '',
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
									character: 23,
									line: 0
								}
							},
							uri: 'file:///a.ts'
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
									character: 8,
									line: 0
								}
							},
							uri: 'file:///c.ts'
						},
						symbol: {
							containerKind: '',
							containerName: '',
							kind: 'var',
							name: 'x'
						}
					},
					{
						symbol: {
							containerName: '',
							containerKind: '',
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
									character: 5,
									line: 0
								}
							},
							uri: 'file:///foo/b.ts'
						}
					},
					{
						symbol: {
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
									character: 9,
									line: 0
								}
							},
							uri: 'file:///foo/b.ts'
						}
					},
					{
						symbol: {
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
									character: 22,
									line: 0
								}
							},
							uri: 'file:///foo/b.ts'
						}
					},
					{
						symbol: {
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
									character: 51,
									line: 0
								}
							},
							uri: 'file:///foo/b.ts'
						}
					},
					{
						symbol: {
							containerName: '',
							containerKind: '',
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
									character: 67,
									line: 0
								}
							},
							uri: 'file:///foo/b.ts'
						}
					}
				]);
			} as any);
		} as any);
	} as any);

	describe('Dependency detection', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///package.json', JSON.stringify({
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
			['file:///node_modules/dep/package.json', JSON.stringify({
				name: 'foo',
				dependencies: {
					shouldnotinclude: '0.0.0'
				}
			})],
			['file:///subproject/package.json', JSON.stringify({
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
				const result = await this.service.workspaceXdependencies().toPromise();
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
				const result = await this.service.workspaceXpackages().toPromise();
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
		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///a.ts', 'let parameters = [];']
		])) as any);

		afterEach(shutdownService as any);

		specify('type of parameters should be any[]', async function (this: TestContext) {
			const result = await this.service.textDocumentHover({
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
		} as any);
	} as any);

	describe('Live updates', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///a.ts', 'let parameters = [];']
		])) as any);

		afterEach(shutdownService as any);

		it('should handle didChange when configuration is not yet initialized', async function (this: TestContext) {

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

			await this.service.textDocumentDidChange({
				textDocument: {
					uri: 'file:///a.ts',
					version: 1
				},
				contentChanges: [{
					text: 'let parameters: number[]'
				}]
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: number[]'
				}]
			});
		} as any);

		it('should handle didClose when configuration is not yet initialized', async function (this: TestContext) {

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

			await this.service.textDocumentDidClose({
				textDocument: {
					uri: 'file:///a.ts'
				}
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: any[]'
				}]
			});
		} as any);

		it('should reflect updated content', async function (this: TestContext) {

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

			assert.deepEqual(await this.service.textDocumentHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: any[]'
				}]
			});

			await this.service.textDocumentDidOpen({
				textDocument: {
					uri: 'file:///a.ts',
					languageId: 'typescript',
					version: 1,
					text: 'let parameters: string[]'
				}
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: string[]'
				}]
			});

			await this.service.textDocumentDidChange({
				textDocument: {
					uri: 'file:///a.ts',
					version: 2
				},
				contentChanges: [{
					text: 'let parameters: number[]'
				}]
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: number[]'
				}]
			});

			await this.service.textDocumentDidClose({
				textDocument: {
					uri: 'file:///a.ts'
				}
			});

			assert.deepEqual(await this.service.textDocumentHover(hoverParams), {
				range,
				contents: [{
					language: 'typescript',
					value: 'let parameters: any[]'
				}]
			});
		} as any);
	} as any);

	describe('References and imports', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, new Map([
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
		])) as any);

		afterEach(shutdownService as any);

		describe('textDocumentDefinition()', function (this: TestContext) {
			it('should resolve symbol imported with tripe-slash reference', async function (this: TestContext) {
				const result = await this.service.textDocumentDefinition({
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
				const result = await this.service.textDocumentDefinition({
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
				const result = await this.service.textDocumentDefinition({
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
				const result = await this.service.textDocumentDefinition({
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
		beforeEach(initializeTypeScriptService(createService, new Map([
				['file:///tsconfig.json', JSON.stringify({
					compilerOptions: {
						lib: ['es2016', 'dom']
					}
				})],
				['file:///a.ts', 'function foo(n: Node): {console.log(n.parentNode, NaN})}']
		])) as any);

		afterEach(shutdownService as any);

		describe('textDocumentHover()', function (this: TestContext) {
			it('should load local library file', async function (this: TestContext) {
				const result = await this.service.textDocumentHover({
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
			} as any);
			it('should resolve TS libraries to github URL', async function (this: TestContext) {
				assert.deepEqual(await this.service.textDocumentDefinition({
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
							line: 8248,
							character: 10
						},
						end: {
							line: 8248,
							character: 14
						}
					}
				}, {
					uri: 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/lib.dom.d.ts',
					range: {
						start: {
							line: 8300,
							character: 12
						},
						end: {
							line: 8300,
							character: 16
						}
					}
				}]);

				assert.deepEqual(await this.service.textDocumentDefinition({
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
							character: 17
						}
					}
				}]);
			} as any);
		} as any);
	} as any);

	describe('textDocumentReferences()', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///a.ts', [
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
			['file:///uses-import.ts', [
				'import * as i from "./import"',
				'i.d()'
			].join('\n')],
			['file:///also-uses-import.ts', [
				'import {d} from "./import"',
				'd()'
			].join('\n')],
			['file:///import.ts', '/** d doc*/ export function d() {}']
		])) as any);

		afterEach(shutdownService as any);

		it('should provide an empty response when no reference is found', async function (this: TestContext) {
			const result = await this.service.textDocumentReferences({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 0
				},
				context: { includeDeclaration: false }
			}).toPromise();
			assert.deepEqual(result, []);
		} as any);

		it('should include the declaration if requested', async function (this: TestContext) {
			const result = await this.service.textDocumentReferences({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 4,
					character: 5
				},
				context: { includeDeclaration: true }
			}).toPromise();
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
				uri: 'file:///a.ts'
			}]);
		} as any);

		it('should provide a reference within the same file', async function (this: TestContext) {
			const result = await this.service.textDocumentReferences({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 10,
					character: 5
				},
				context: { includeDeclaration: false }
			}).toPromise();
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
				uri: 'file:///a.ts'
			}]);
		} as any);
		it('should provide two references from imports', async function (this: TestContext) {
			const result = await this.service.textDocumentReferences({
				textDocument: {
					uri: 'file:///import.ts'
				},
				position: {
					line: 0,
					character: 28
				},
				context: { includeDeclaration: false }
			}).toPromise();
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
					uri: 'file:///uses-import.ts'
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
					uri: 'file:///also-uses-import.ts'
				}
			]);
		} as any);
	} as any);

	describe('textDocumentSignatureHelp()', function (this: TestContext) {
		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///a.ts', [
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
			['file:///uses-import.ts', [
				'import * as i from "./import"',
				'i.d()'
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
		])) as any);

		afterEach(shutdownService as any);

		it('should provide a valid empty response when no signature is found', async function (this: TestContext) {
			const result = await this.service.textDocumentSignatureHelp({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 0,
					character: 0
				}
			});
			assert.deepEqual(result, {
				signatures: [],
				activeSignature: 0,
				activeParameter: 0
			});
		} as any);

		it('should provide signature help with parameters in the same file', async function (this: TestContext) {
			const result = await this.service.textDocumentSignatureHelp({
				textDocument: {
					uri: 'file:///a.ts'
				},
				position: {
					line: 15,
					character: 11
				}
			});
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
			const result = await this.service.textDocumentSignatureHelp({
				textDocument: {
					uri: 'file:///uses-import.ts'
				},
				position: {
					line: 1,
					character: 4
				}
			});
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
		beforeEach(initializeTypeScriptService(createService, new Map([
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
		])) as any);

		afterEach(shutdownService as any);

		it('produces completions in the same file', async function (this: TestContext) {
			const result = await this.service.textDocumentCompletion({
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
		} as any);
		it('produces completions for imported symbols', async function (this: TestContext) {
			const result = await this.service.textDocumentCompletion({
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
		} as any);
		it('produces completions for referenced symbols', async function (this: TestContext) {
			const result = await this.service.textDocumentCompletion({
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
		} as any);
		it('produces completions for empty files', async function (this: TestContext) {
			const result = await this.service.textDocumentCompletion({
				textDocument: {
					uri: 'file:///empty.ts'
				},
				position: {
					line: 0,
					character: 0
				}
			});
			assert.notDeepEqual(result.items.length, []);
		} as any);
	} as any);

	describe('Special file names', function (this: TestContext) {

		beforeEach(initializeTypeScriptService(createService, new Map([
			['file:///keywords-in-path/class/constructor/a.ts', 'export function a() {}'],
			['file:///special-characters-in-path/%40foo/b.ts', 'export function b() {}'],
			['file:///windows/app/master.ts', '/// <reference path="..\\lib\\master.ts" />\nc();'],
			['file:///windows/lib/master.ts', '/// <reference path="..\\lib\\slave.ts" />'],
			['file:///windows/lib/slave.ts', 'function c() {}']
		])) as any);

		afterEach(shutdownService as any);

		it('should accept files with TypeScript keywords in path', async function (this: TestContext) {
			const result = await this.service.textDocumentHover({
				textDocument: {
					uri: 'file:///keywords-in-path/class/constructor/a.ts'
				},
				position: {
					line: 0,
					character: 16
				}
			});
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
				contents: [{
					language: 'typescript',
					value: 'function a(): void'
				}]
			});
		} as any);
		it('should accept files with special characters in path', async function (this: TestContext) {
			const result = await this.service.textDocumentHover({
				textDocument: {
					uri: 'file:///special-characters-in-path/%40foo/b.ts'
				},
				position: {
					line: 0,
					character: 16
				}
			});
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
				contents: [{
					language: 'typescript',
					value: 'function b(): void'
				}]
			});
		} as any);
		it('should handle Windows-style paths in triple slash references', async function (this: TestContext) {
			const result = await this.service.textDocumentDefinition({
				textDocument: {
					uri: 'file:///windows/app/master.ts'
				},
				position: {
					line: 1,
					character: 0
				}
			});
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
				uri: 'file:///windows/lib/slave.ts'
			}]);
		} as any);
	} as any);
}
