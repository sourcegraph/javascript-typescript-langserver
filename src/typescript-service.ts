import * as fs from 'fs';
import * as os from 'os';
import * as path_ from 'path';
import * as ts from 'typescript';
import {
	IConnection,
	createConnection,
	InitializeParams,
	InitializeResult,
	TextDocuments,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	Definition,
	ReferenceParams,
	Position,
	Location,
	Hover,
	WorkspaceSymbolParams,
	DocumentSymbolParams,
	SymbolInformation,
	RequestType,
	Range,
	DidOpenTextDocumentParams,
	DidCloseTextDocumentParams,
	DidChangeTextDocumentParams,
	DidSaveTextDocumentParams
} from 'vscode-languageserver';

import * as async from 'async';

import * as FileSystem from './fs';
import * as util from './util';
import * as pm from './project-manager';
import * as rt from './request-type';

import { LanguageHandler } from './lang-handler';

var sanitizeHtml = require('sanitize-html');
var JSONPath = require('jsonpath-plus');

/**
 * TypeScriptService handles incoming requests and return
 * responses. There is a one-to-one-to-one correspondence between TCP
 * connection, TypeScriptService instance, and language
 * workspace. TypeScriptService caches data from the compiler across
 * requests. The lifetime of the TypeScriptService instance is tied to
 * the lifetime of the TCP connection, so its caches are deleted after
 * the connection is torn down.
 */
export class TypeScriptService implements LanguageHandler {

	projectManager: pm.ProjectManager;
	root: string;

	private strict: boolean;
	private emptyQueryWorkspaceSymbols: Promise<SymbolInformation[]>; // cached response for empty workspace/symbol query
	private initialized: Promise<InitializeResult>;

	initialize(params: InitializeParams, remoteFs: FileSystem.FileSystem, strict: boolean): Promise<InitializeResult> {
		if (this.initialized) {
			return this.initialized;
		}
		this.initialized = new Promise<InitializeResult>((resolve) => {
			if (params.rootPath) {
				this.root = util.uri2path(params.rootPath);
				this.strict = strict;
				this.projectManager = new pm.ProjectManager(this.root, remoteFs);

				this.ensureFilesForWorkspaceSymbol(); // pre-fetching

				resolve({
					capabilities: {
						// Tell the client that the server works in FULL text document sync mode
						textDocumentSync: TextDocumentSyncKind.Full,
						hoverProvider: true,
						definitionProvider: true,
						referencesProvider: true,
						workspaceSymbolProvider: true
					}
				})
			}
		});
		return this.initialized;
	}

	private ensuredFilesForHoverAndDefinition = new Map<string, Promise<void>>();

	private ensureFilesForHoverAndDefinition(uri: string): Promise<void> {
		if (this.ensuredFilesForHoverAndDefinition.get(uri)) {
			return this.ensuredFilesForHoverAndDefinition.get(uri);
		}

		const promise = this.projectManager.ensureModuleStructure().then(() => {
			// include dependencies up to depth 30
			const deps = new Set<string>();
			return this.ensureTransitiveFileDependencies([util.uri2path(uri)], 30, deps).then(() => {
				return this.projectManager.refreshConfigurations();
			});
		});
		this.ensuredFilesForHoverAndDefinition.set(uri, promise);
		promise.catch((err) => {
			console.error("Failed to fetch files for hover/definition for uri ", uri, ", error:", err);
			this.ensuredFilesForHoverAndDefinition.delete(uri);
		});
		return promise;
	}

	private ensureTransitiveFileDependencies(fileNames: string[], maxDepth: number, seen: Set<string>): Promise<void> {
		fileNames = fileNames.filter((f) => !seen.has(f));
		if (fileNames.length === 0) {
			return Promise.resolve();
		}
		fileNames.forEach((f) => seen.add(f));

		const absFileNames = fileNames.map((f) => util.normalizePath(util.resolve(this.root, f)));
		let promise = this.projectManager.ensureFiles(absFileNames);

		if (maxDepth > 0) {
			promise = promise.then(() => {
				const importFiles = new Set<string>();
				return Promise.all(fileNames.map((fileName) => {
					return this.projectManager.getConfiguration(fileName).prepare().then((config) => {
						const contents = this.projectManager.getFs().readFile(fileName) || '';
						const info = ts.preProcessFile(contents, true, true);
						const compilerOpt = config.host.getCompilationSettings();
						for (const imp of info.importedFiles) {
							const resolved = ts.resolveModuleName(imp.fileName, fileName, compilerOpt, config.moduleResolutionHost());
							if (!resolved || !resolved.resolvedModule) {
								// This means we didn't find a file defining
								// the module. It could still exist as an
								// ambient module, which is why we fetch
								// global*.d.ts files.
								continue;
							}
							importFiles.add(resolved.resolvedModule.resolvedFileName);
						}
						const resolver = !this.strict && os.platform() == 'win32' ? path_ : path_.posix;
						for (const ref of info.referencedFiles) {
							// Resolving triple slash references relative to current file
							// instead of using module resolution host because it behaves
							// differently in "nodejs" mode
							const refFileName = util.normalizePath(path_.relative(this.root,
								resolver.resolve(this.root,
									resolver.dirname(fileName),
									ref.fileName)));
							importFiles.add(refFileName);
						}
					});
				})).then(() => {
					return this.ensureTransitiveFileDependencies(Array.from(importFiles), maxDepth - 1, seen);
				});
			});
		}
		return promise;
	}

	private ensuredFilesForWorkspaceSymbol: Promise<void> = null;

	private ensureFilesForWorkspaceSymbol(): Promise<void> {
		if (this.ensuredFilesForWorkspaceSymbol) {
			return this.ensuredFilesForWorkspaceSymbol;
		}

		const self = this;
		const filesToEnsure = [];
		const promise = this.projectManager.walkRemote(this.projectManager.getRemoteRoot(), function (path: string, info: FileSystem.FileInfo, err?: Error): (Error | null) {
			if (err) {
				return err;
			} else if (info.dir) {
				if (util.normalizePath(info.name).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
					return pm.skipDir;
				} else {
					return null;
				}
			}
			if (util.isJSTSFile(path) || util.isConfigFile(path) || util.isPackageJsonFile(path)) {
				filesToEnsure.push(path);
			}
			return null;
		}).then(() => {
			return this.projectManager.ensureFiles(filesToEnsure)
		}).then(() => {
			return this.projectManager.refreshConfigurations();
		});

		this.ensuredFilesForWorkspaceSymbol = promise;
		promise.catch((err) => {
			console.error("Failed to fetch files for workspace/symbol:", err);
			this.ensuredFilesForWorkspaceSymbol = null;
		});

		return promise;
	}

	private ensuredAllFiles: Promise<void> = null;

	private ensureFilesForReferences(uri: string): Promise<void> {
		const fileName: string = util.uri2path(uri);
		if (util.normalizePath(fileName).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
			return this.ensureFilesForWorkspaceSymbol();
		}

		if (this.ensuredAllFiles) {
			return this.ensuredAllFiles;
		}

		const filesToEnsure = [];
		const promise = this.projectManager.walkRemote(this.projectManager.getRemoteRoot(), function (path: string, info: FileSystem.FileInfo, err?: Error): (Error | null) {
			if (err) {
				return err;
			} else if (info.dir) {
				return null;
			}
			if (util.isJSTSFile(path)) {
				filesToEnsure.push(path);
			}
			return null;
		}).then(() => {
			return this.projectManager.ensureFiles(filesToEnsure)
		}).then(() => {
			return this.projectManager.refreshConfigurations();
		});

		this.ensuredAllFiles = promise;
		promise.catch((err) => {
			console.error("Failed to fetch files for references:", err);
			this.ensuredAllFiles = null;
		});

		return promise;
	}

	getDefinition(params: TextDocumentPositionParams): Promise<Location[]> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		const line = params.position.line;
		const column = params.position.character;
		return this.ensureFilesForHoverAndDefinition(uri).then(() => new Promise<Location[]>((resolve, reject) => {
			const fileName: string = util.uri2path(uri);
			try {
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.prepare().then((configuration) => {
					try {
						const sourceFile = this.getSourceFile(configuration, fileName);
						if (!sourceFile) {
							return resolve([]);
						}
						const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
						const defs: ts.DefinitionInfo[] = configuration.service.getDefinitionAtPosition(fileName, offset);
						const ret = [];
						if (defs) {
							for (let def of defs) {
								const sourceFile = this.getSourceFile(configuration, def.fileName);
								const start = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
								const end = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start + def.textSpan.length);
								ret.push(Location.create(this.defUri(def.fileName), {
									start: start,
									end: end
								}));
							}
						}
						return resolve(ret);
					} catch (e) {
						return reject(e);
					}

				}, (e) => {
					return reject(e);
				});
			} catch (e) {
				return reject(e);
			}
		}));
	}

	getHover(params: TextDocumentPositionParams): Promise<Hover> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root)
		const line = params.position.line;
		const column = params.position.character;
		return this.ensureFilesForHoverAndDefinition(uri).then(() => new Promise<Hover>((resolve, reject) => {
			const fileName: string = util.uri2path(uri);
			try {
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.prepare().then(() => {
					try {
						const sourceFile = this.getSourceFile(configuration, fileName);
						if (!sourceFile) {
							return resolve(null);
						}
						const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
						const info = configuration.service.getQuickInfoAtPosition(fileName, offset);
						if (!info) {
							return resolve(null);
						}

						const contents = [];
						contents.push({
							language: 'typescript',
							value: ts.displayPartsToString(info.displayParts)
						});
						let documentation = ts.displayPartsToString(info.documentation);
						if (documentation) {
							contents.push(documentation);
						}
						const start = ts.getLineAndCharacterOfPosition(sourceFile, info.textSpan.start);
						const end = ts.getLineAndCharacterOfPosition(sourceFile, info.textSpan.start + info.textSpan.length);

						return resolve({ contents: contents, range: Range.create(start.line, start.character, end.line, end.character) });
					} catch (e) {
						return reject(e);
					}
				}, (e) => {
					return reject(e);
				});
			} catch (e) {
				return reject(e);
			}
		}));
	}

	getReferences(params: ReferenceParams): Promise<Location[]> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root)
		const line = params.position.line;
		const column = params.position.character;
		return this.ensureFilesForReferences(uri).then(() => new Promise<Location[]>((resolve, reject) => {
			const fileName: string = util.uri2path(uri);
			try {
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.prepare().then(() => {
					try {
						const sourceFile = this.getSourceFile(configuration, fileName);
						if (!sourceFile) {
							return resolve([]);
						}

						const started = new Date().getTime();

						this.projectManager.syncConfigurationFor(fileName);

						const prepared = new Date().getTime();

						const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
						const refs = configuration.service.getReferencesAtPosition(fileName, offset);

						const fetched = new Date().getTime();
						const ret = [];
						const tasks = [];

						if (refs) {
							for (let ref of refs) {
								tasks.push(this.transformReference(this.root, configuration.program, ref));
							}
						}
						async.parallel(tasks, (err: Error, results: Location[]) => {
							const finished = new Date().getTime();
							console.error('references', 'transform', (finished - fetched) / 1000.0, 'fetch', (fetched - prepared) / 1000.0, 'prepare', (prepared - started) / 1000.0);
							return resolve(results);
						});

					} catch (e) {
						return reject(e);
					}
				}, (e) => {
					return reject(e);
				});

			} catch (e) {
				return reject(e);
			}
		}));
	}

	getWorkspaceSymbols(params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]> {
		const query = params.query;
		const limit = params.limit;
		return this.ensureFilesForWorkspaceSymbol().then(() => {
			if (!query && this.emptyQueryWorkspaceSymbols) {
				return this.emptyQueryWorkspaceSymbols;
			}

			const p = new Promise<SymbolInformation[]>((resolve, reject) => {
				const configurations = this.projectManager.getConfigurations();
				const index = 0;
				const items = [];
				this.collectWorkspaceSymbols(query, limit, configurations, index, items, () => {
					if (!query) {
						const sortedItems = items.sort((a, b) =>
							a.matchKind - b.matchKind ||
							a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()));
						return resolve(sortedItems);
					}
					return resolve(items);
				});
			});
			if (!query) {
				this.emptyQueryWorkspaceSymbols = p;
			}
			return p;
		});
	}

	getDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		return this.ensureFilesForHoverAndDefinition(uri).then(() => {
			const fileName = util.uri2path(uri);

			const config = this.projectManager.getConfiguration(uri);
			return config.prepare().then(() => {
				const sourceFile = this.getSourceFile(config, fileName);
				const tree = config.service.getNavigationTree(fileName);
				const result: SymbolInformation[] = [];
				this.flattenNavigationTreeItem(tree, null, sourceFile, result);
				return Promise.resolve(result);
			});
		});
	}

	getWorkspaceReference(params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]> {
		const refInfo: rt.ReferenceInformation[] = [];
		return this.ensureFilesForWorkspaceSymbol().then(() => {
			return Promise.all(this.projectManager.getConfigurations().map((config) => {
				return config.prepare().then((config) => {
					this.projectManager.syncConfiguration(config);
					for (let source of config.service.getProgram().getSourceFiles().sort((a, b) => a.fileName.localeCompare(b.fileName))) {
						if (util.normalizePath(source.fileName).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
							continue;
						}
						this.walkMostAST(source, (node) => {
							switch (node.kind) {
								case ts.SyntaxKind.Identifier: {
									const id = node as ts.Identifier;
									const defs = config.service.getDefinitionAtPosition(source.fileName, node.pos + 1);

									if (defs && defs.length > 0) {
										const def = defs[0];
										const start = ts.getLineAndCharacterOfPosition(source, node.pos);
										const end = ts.getLineAndCharacterOfPosition(source, node.end);
										const ref = {
											location: {
												uri: this.defUri(source.fileName),
												range: {
													start: start,
													end: end,
												},
											},
											name: def.name,
											containerName: def.containerName,
											uri: this.defUri(def.fileName),
										};
										refInfo.push(ref);
									}
									break;
								}
								case ts.SyntaxKind.StringLiteral: {
									// TODO
									break;
								}
							}
						});
					}
				});
			}));
		}).then(() => {
			return refInfo;
		});
	}

	/*
	 * walkMostAST walks most of the AST (the part that matters for gathering all references)
	 */
	private walkMostAST(node: ts.Node, visit: (node: ts.Node) => void) {
		visit(node);
		const children: ts.Node[] = [];
		switch (node.kind) {
			case ts.SyntaxKind.QualifiedName: {
				const n = node as ts.QualifiedName;
				children.push(n.left, n.right);
				break;
			}
			case ts.SyntaxKind.ComputedPropertyName: {
				const n = node as ts.ComputedPropertyName;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.TypeParameter: {
				const n = node as ts.TypeParameterDeclaration;
				children.push(n.name, n.constraint, n.expression);
				break;
			}
			case ts.SyntaxKind.Parameter: {
				const n = node as ts.ParameterDeclaration;
				children.push(n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.Decorator: {
				const n = node as ts.Decorator;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.PropertySignature: {
				const n = node as ts.PropertySignature;
				children.push(n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.PropertyDeclaration: {
				const n = node as ts.PropertyDeclaration;
				children.push(n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.MethodSignature: {
				const n = node as ts.MethodSignature;
				children.push(n.name, n.type);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				if (n.parameters) {
					children.push(...n.parameters);
				}
				break;
			}
			case ts.SyntaxKind.MethodDeclaration: {
				const n = node as ts.MethodDeclaration;
				children.push(n.name, n.body);
				break;
			}
			case ts.SyntaxKind.Constructor: {
				const n = node as ts.ConstructorDeclaration;
				children.push(n.name, n.body);
				break;
			}
			case ts.SyntaxKind.GetAccessor: {
				const n = node as ts.GetAccessorDeclaration;
				children.push(n.name, n.body);
				break;
			}
			case ts.SyntaxKind.SetAccessor: {
				const n = node as ts.SetAccessorDeclaration;
				children.push(n.name, n.body);
				break;
			}
			case ts.SyntaxKind.CallSignature: {
				const n = node as ts.CallSignatureDeclaration;
				children.push(n.name, n.type);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				if (n.parameters) {
					children.push(...n.parameters);
				}
				break;
			}
			case ts.SyntaxKind.ConstructSignature: {
				const n = node as ts.ConstructSignatureDeclaration;
				children.push(n.name, n.type);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				if (n.parameters) {
					children.push(...n.parameters);
				}
				break;
			}
			case ts.SyntaxKind.IndexSignature: {
				const n = node as ts.IndexSignatureDeclaration;
				children.push(n.name, n.type);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				if (n.parameters) {
					children.push(...n.parameters);
				}
				break;
			}
			case ts.SyntaxKind.TypePredicate: {
				const n = node as ts.TypePredicateNode;
				children.push(n.parameterName, n.type);
				break;
			}
			case ts.SyntaxKind.TypeReference: {
				const n = node as ts.TypeReferenceNode;
				children.push(n.typeName);
				if (n.typeArguments) {
					children.push(...n.typeArguments);
				}
				break;
			}
			case ts.SyntaxKind.ConstructorType:
			case ts.SyntaxKind.FunctionType: {
				const n = node as ts.FunctionOrConstructorTypeNode;
				children.push(n.name, n.type);
				children.push(n.name, n.type);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				if (n.parameters) {
					children.push(...n.parameters);
				}
				break;
			}
			case ts.SyntaxKind.TypeQuery: {
				const n = node as ts.TypeQueryNode;
				children.push(n.exprName);
				break;
			}
			case ts.SyntaxKind.TypeLiteral: {
				const n = node as ts.TypeLiteralNode;
				children.push(n.name);
				children.push(...n.members);
				break;
			}
			case ts.SyntaxKind.ArrayType: {
				const n = node as ts.ArrayTypeNode;
				children.push(n.elementType);
				break;
			}
			case ts.SyntaxKind.TupleType: {
				const n = node as ts.TupleTypeNode;
				children.push(...n.elementTypes);
				break;
			}
			case ts.SyntaxKind.IntersectionType:
			case ts.SyntaxKind.UnionType: {
				const n = node as ts.UnionTypeNode;
				children.push(...n.types);
				break;
			}
			case ts.SyntaxKind.ParenthesizedType: {
				const n = node as ts.ParenthesizedTypeNode;
				children.push(n.type);
				break;
			}
			case ts.SyntaxKind.LiteralType: {
				const n = node as ts.LiteralTypeNode;
				children.push(n.literal);
				break;
			}
			case ts.SyntaxKind.ObjectBindingPattern:
			case ts.SyntaxKind.ArrayBindingPattern: {
				const n = node as ts.ObjectBindingPattern;
				children.push(...n.elements);
				break;
			}
			case ts.SyntaxKind.BindingElement: {
				const n = node as ts.BindingElement;
				children.push(n.propertyName, n.name, n.initializer);
				break;
			}
			case ts.SyntaxKind.ArrayLiteralExpression: {
				const n = node as ts.ArrayLiteralExpression;
				children.push(...n.elements);
				break;
			}
			case ts.SyntaxKind.ObjectLiteralExpression: {
				const n = node as ts.ObjectLiteralExpression;
				children.push(...n.properties);
				break;
			}
			case ts.SyntaxKind.PropertyAccessExpression: {
				const n = node as ts.PropertyAccessExpression;
				children.push(n.expression, n.name);
				break;
			}
			case ts.SyntaxKind.ElementAccessExpression: {
				const n = node as ts.ElementAccessExpression;
				children.push(n.expression, n.argumentExpression);
				break;
			}
			case ts.SyntaxKind.CallExpression: {
				const n = node as ts.CallExpression;
				children.push(n.name, n.expression, ...n.arguments);
				if (n.typeArguments) {
					children.push(...n.typeArguments);
				}
				break;
			}
			case ts.SyntaxKind.NewExpression: {
				const n = node as ts.NewExpression;
				children.push(n.name, n.expression, ...n.arguments);
				if (n.typeArguments) {
					children.push(...n.typeArguments);
				}
				break;
			}
			case ts.SyntaxKind.TaggedTemplateExpression: {
				const n = node as ts.TaggedTemplateExpression;
				children.push(n.tag, n.template);
				break;
			}
			case ts.SyntaxKind.TypeAssertionExpression: {
				const n = node as ts.TypeAssertion;
				children.push(n.type, n.expression);
				break;
			}
			case ts.SyntaxKind.ParenthesizedExpression: {
				const n = node as ts.ParenthesizedExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.FunctionExpression: {
				const n = node as ts.FunctionExpression;
				children.push(n.name, n.body);
				break;
			}
			case ts.SyntaxKind.ArrowFunction: {
				const n = node as ts.ArrowFunction;
				children.push(n.body);
				break;
			}
			case ts.SyntaxKind.DeleteExpression: {
				const n = node as ts.DeleteExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.TypeOfExpression: {
				const n = node as ts.TypeOfExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.VoidExpression: {
				const n = node as ts.VoidExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.AwaitExpression: {
				const n = node as ts.AwaitExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.PrefixUnaryExpression: {
				const n = node as ts.PrefixUnaryExpression;
				children.push(n.operand);
				break;
			}
			case ts.SyntaxKind.PostfixUnaryExpression: {
				const n = node as ts.PostfixUnaryExpression;
				children.push(n.operand);
				break;
			}
			case ts.SyntaxKind.BinaryExpression: {
				const n = node as ts.BinaryExpression;
				children.push(n.left, n.right);
				break;
			}
			case ts.SyntaxKind.ConditionalExpression: {
				const n = node as ts.ConditionalExpression;
				children.push(n.condition, n.whenTrue, n.whenFalse);
				break;
			}
			case ts.SyntaxKind.TemplateExpression: {
				const n = node as ts.TemplateExpression;
				children.push(n.head, ...n.templateSpans);
				break;
			}
			case ts.SyntaxKind.YieldExpression: {
				const n = node as ts.YieldExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.SpreadElementExpression: {
				const n = node as ts.SpreadElementExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.ClassExpression: {
				const n = node as ts.ClassExpression;
				children.push(n.name, ...n.members);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				if (n.heritageClauses) {
					children.push(...n.heritageClauses);
				}
				break;
			}
			case ts.SyntaxKind.ExpressionWithTypeArguments: {
				const n = node as ts.ExpressionWithTypeArguments;
				children.push(n.expression);
				if (n.typeArguments) {
					children.push(...n.typeArguments);
				}
				break;
			}
			case ts.SyntaxKind.AsExpression: {
				const n = node as ts.AsExpression;
				children.push(n.expression, n.type);
				break;
			}
			case ts.SyntaxKind.NonNullExpression: {
				const n = node as ts.NonNullExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.TemplateSpan: {
				const n = node as ts.TemplateSpan;
				children.push(n.expression, n.literal);
				break;
			}
			case ts.SyntaxKind.SemicolonClassElement: {
				const n = node as ts.SemicolonClassElement;
				children.push(n.name);
				break;
			}
			case ts.SyntaxKind.Block: {
				const n = node as ts.Block;
				children.push(...n.statements);
				break;
			}
			case ts.SyntaxKind.VariableStatement: {
				const n = node as ts.VariableStatement;
				children.push(n.declarationList);
				break;
			}
			case ts.SyntaxKind.ExpressionStatement: {
				const n = node as ts.ExpressionStatement;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.IfStatement: {
				const n = node as ts.IfStatement;
				children.push(n.expression, n.thenStatement, n.elseStatement);
				break;
			}
			case ts.SyntaxKind.DoStatement: {
				const n = node as ts.DoStatement;
				children.push(n.expression, n.statement);
				break;
			}
			case ts.SyntaxKind.WhileStatement: {
				const n = node as ts.WhileStatement;
				children.push(n.expression, n.statement);
				break;
			}
			case ts.SyntaxKind.ForStatement: {
				const n = node as ts.ForStatement;
				children.push(n.initializer, n.condition, n.incrementor, n.statement);
				break;
			}
			case ts.SyntaxKind.ForInStatement: {
				const n = node as ts.ForInStatement;
				children.push(n.initializer, n.expression, n.statement);
				break;
			}
			case ts.SyntaxKind.ForOfStatement: {
				const n = node as ts.ForOfStatement;
				children.push(n.initializer, n.expression, n.statement);
				break;
			}
			case ts.SyntaxKind.ContinueStatement: {
				const n = node as ts.ContinueStatement;
				children.push(n.label);
				break;
			}
			case ts.SyntaxKind.BreakStatement: {
				const n = node as ts.BreakStatement;
				children.push(n.label);
				break;
			}
			case ts.SyntaxKind.ReturnStatement: {
				const n = node as ts.ReturnStatement;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.WithStatement: {
				const n = node as ts.WithStatement;
				children.push(n.expression, n.statement);
				break;
			}
			case ts.SyntaxKind.SwitchStatement: {
				const n = node as ts.SwitchStatement;
				children.push(n.expression, n.caseBlock);
				break;
			}
			case ts.SyntaxKind.LabeledStatement: {
				const n = node as ts.LabeledStatement;
				children.push(n.label, n.statement);
				break;
			}
			case ts.SyntaxKind.ThrowStatement: {
				const n = node as ts.ThrowStatement;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.TryStatement: {
				const n = node as ts.TryStatement;
				children.push(n.tryBlock, n.catchClause, n.finallyBlock);
				break;
			}
			case ts.SyntaxKind.VariableDeclaration: {
				const n = node as ts.VariableDeclaration;
				children.push(n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.VariableDeclarationList: {
				const n = node as ts.VariableDeclarationList;
				children.push(...n.declarations);
				break;
			}
			case ts.SyntaxKind.FunctionDeclaration: {
				const n = node as ts.FunctionDeclaration;
				children.push(n.name, n.body, n.type, ...n.parameters);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				break;
			}
			case ts.SyntaxKind.ClassDeclaration: {
				const n = node as ts.ClassDeclaration;
				children.push(n.name, ...n.members);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				if (n.heritageClauses) {
					children.push(...n.heritageClauses);
				}
				break;
			}
			case ts.SyntaxKind.InterfaceDeclaration: {
				const n = node as ts.InterfaceDeclaration;
				children.push(n.name, ...n.members);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				if (n.heritageClauses) {
					children.push(...n.heritageClauses);
				}
				break;
			}
			case ts.SyntaxKind.TypeAliasDeclaration: {
				const n = node as ts.TypeAliasDeclaration;
				children.push(n.name, n.type);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				break;
			}
			case ts.SyntaxKind.EnumDeclaration: {
				const n = node as ts.EnumDeclaration;
				children.push(n.name, ...n.members);
				break;
			}
			case ts.SyntaxKind.ModuleDeclaration: {
				const n = node as ts.ModuleDeclaration;
				children.push(n.name, n.body);
				break;
			}
			case ts.SyntaxKind.ModuleBlock: {
				const n = node as ts.ModuleBlock;
				children.push(...n.statements);
				break;
			}
			case ts.SyntaxKind.CaseBlock: {
				const n = node as ts.CaseBlock;
				children.push(...n.clauses);
				break;
			}
			case ts.SyntaxKind.NamespaceExportDeclaration: {
				const n = node as ts.NamespaceExportDeclaration;
				children.push(n.name, n.moduleReference);
				break;
			}
			case ts.SyntaxKind.ImportEqualsDeclaration: {
				const n = node as ts.ImportEqualsDeclaration;
				children.push(n.name, n.moduleReference);
				break;
			}
			case ts.SyntaxKind.ImportDeclaration: {
				const n = node as ts.ImportDeclaration;
				children.push(n.importClause, n.moduleSpecifier);
				break;
			}
			case ts.SyntaxKind.ImportClause: {
				const n = node as ts.ImportClause;
				children.push(n.name, n.namedBindings);
				break;
			}
			case ts.SyntaxKind.NamespaceImport: {
				const n = node as ts.NamespaceImport;
				children.push(n.name);
				break;
			}
			case ts.SyntaxKind.NamedImports: {
				const n = node as ts.NamedImports;
				children.push(...n.elements);
				break;
			}
			case ts.SyntaxKind.ImportSpecifier: {
				const n = node as ts.ImportSpecifier;
				children.push(n.propertyName, n.name);
				break;
			}
			case ts.SyntaxKind.ExportAssignment: {
				const n = node as ts.ExportAssignment;
				children.push(n.name, n.expression);
				break;
			}
			case ts.SyntaxKind.ExportDeclaration: {
				const n = node as ts.ExportDeclaration;
				children.push(n.exportClause, n.moduleSpecifier, n.name);
				break;
			}
			case ts.SyntaxKind.NamedExports: {
				const n = node as ts.NamedExports;
				children.push(...n.elements);
				break;
			}
			case ts.SyntaxKind.ExportSpecifier: {
				const n = node as ts.ExportSpecifier;
				children.push(n.propertyName, n.name);
				break;
			}
			case ts.SyntaxKind.MissingDeclaration: {
				const n = node as ts.MissingDeclaration;
				children.push(n.name);
				break;
			}
			case ts.SyntaxKind.ExternalModuleReference: {
				const n = node as ts.ExternalModuleReference;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.JsxElement: {
				const n = node as ts.JsxElement;
				children.push(n.openingElement, n.closingElement, ...n.children);
				break;
			}
			case ts.SyntaxKind.JsxSelfClosingElement: {
				const n = node as ts.JsxSelfClosingElement;
				children.push(n.tagName, ...n.attributes);
				break;
			}
			case ts.SyntaxKind.JsxOpeningElement: {
				const n = node as ts.JsxOpeningElement;
				children.push(n.tagName, ...n.attributes);
				break;
			}
			case ts.SyntaxKind.JsxClosingElement: {
				const n = node as ts.JsxClosingElement;
				children.push(n.tagName);
				break;
			}
			case ts.SyntaxKind.JsxAttribute: {
				const n = node as ts.JsxAttribute;
				children.push(n.name, n.initializer);
				break;
			}
			case ts.SyntaxKind.JsxSpreadAttribute: {
				const n = node as ts.JsxSpreadAttribute;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.JsxExpression: {
				const n = node as ts.JsxExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.CaseClause: {
				const n = node as ts.CaseClause;
				children.push(n.expression, ...n.statements);
				break;
			}
			case ts.SyntaxKind.DefaultClause: {
				const n = node as ts.DefaultClause;
				children.push(...n.statements);
				break;
			}
			case ts.SyntaxKind.HeritageClause: {
				const n = node as ts.HeritageClause;
				if (n.types) {
					children.push(...n.types);
				}
				break;
			}
			case ts.SyntaxKind.CatchClause: {
				const n = node as ts.CatchClause;
				children.push(n.variableDeclaration, n.block);
				break;
			}
			case ts.SyntaxKind.PropertyAssignment: {
				const n = node as ts.PropertyAssignment;
				children.push(n.name, n.initializer);
				break;
			}
			case ts.SyntaxKind.ShorthandPropertyAssignment: {
				const n = node as ts.ShorthandPropertyAssignment;
				children.push(n.name, n.objectAssignmentInitializer);
				break;
			}
			case ts.SyntaxKind.EnumMember: {
				const n = node as ts.EnumMember;
				children.push(n.name, n.initializer);
				break;
			}
			case ts.SyntaxKind.SourceFile: {
				const n = node as ts.SourceFile;
				children.push(...n.statements);
				break;
			}
			case ts.SyntaxKind.JSDocTypeExpression: {
				const n = node as ts.JSDocTypeExpression;
				children.push(n.type);
				break;
			}
			case ts.SyntaxKind.JSDocArrayType: {
				const n = node as ts.JSDocArrayType;
				children.push(n.elementType);
				break;
			}
			case ts.SyntaxKind.JSDocUnionType: {
				const n = node as ts.JSDocUnionType;
				children.push(...n.types);
				break;
			}
			case ts.SyntaxKind.JSDocTupleType: {
				const n = node as ts.JSDocTupleType;
				children.push(...n.types);
				break;
			}
			case ts.SyntaxKind.JSDocNullableType: {
				const n = node as ts.JSDocNullableType;
				children.push(n.type);
				break;
			}
			case ts.SyntaxKind.JSDocNonNullableType: {
				const n = node as ts.JSDocNonNullableType;
				children.push(n.type);
				break;
			}
			case ts.SyntaxKind.JSDocRecordType: {
				const n = node as ts.JSDocRecordType;
				children.push(n.literal);
				break;
			}
			case ts.SyntaxKind.JSDocRecordMember: {
				const n = node as ts.JSDocRecordMember;
				children.push(n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.JSDocTypeReference: {
				const n = node as ts.JSDocTypeReference;
				children.push(n.name, ...n.typeArguments);
				break;
			}
			case ts.SyntaxKind.JSDocOptionalType: {
				const n = node as ts.JSDocOptionalType;
				children.push(n.type);
				break;
			}
			case ts.SyntaxKind.JSDocFunctionType: {
				const n = node as ts.JSDocFunctionType;
				children.push(n.name, n.type, ...n.parameters);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				break;
			}
			case ts.SyntaxKind.JSDocVariadicType: {
				const n = node as ts.JSDocVariadicType;
				children.push(n.type);
				break;
			}
			case ts.SyntaxKind.JSDocConstructorType: {
				const n = node as ts.JSDocConstructorType;
				children.push(n.type);
				break;
			}
			case ts.SyntaxKind.JSDocThisType: {
				const n = node as ts.JSDocThisType;
				children.push(n.type);
				break;
			}
			case ts.SyntaxKind.JSDocComment: {
				const n = node as ts.JSDoc;
				if (n.tags) {
					children.push(...n.tags);
				}
				break;
			}
			case ts.SyntaxKind.JSDocTag: {
				const n = node as ts.JSDocTag;
				children.push(n.tagName);
				break;
			}
			case ts.SyntaxKind.JSDocParameterTag: {
				const n = node as ts.JSDocParameterTag;
				children.push(n.preParameterName, n.typeExpression, n.postParameterName, n.parameterName);
				break;
			}
			case ts.SyntaxKind.JSDocReturnTag: {
				const n = node as ts.JSDocReturnTag;
				children.push(n.typeExpression);
				break;
			}
			case ts.SyntaxKind.JSDocTypeTag: {
				const n = node as ts.JSDocTypeTag;
				children.push(n.typeExpression);
				break;
			}
			case ts.SyntaxKind.JSDocTemplateTag: {
				const n = node as ts.JSDocTemplateTag;
				children.push(...n.typeParameters);
				break;
			}
			case ts.SyntaxKind.JSDocTypedefTag: {
				const n = node as ts.JSDocTypedefTag;
				children.push(n.fullName, n.name, n.typeExpression, n.jsDocTypeLiteral);
				break;
			}
			case ts.SyntaxKind.JSDocPropertyTag: {
				const n = node as ts.JSDocPropertyTag;
				children.push(n.name, n.typeExpression);
				break;
			}
			case ts.SyntaxKind.JSDocTypeLiteral: {
				const n = node as ts.JSDocTypeLiteral;
				if (n.jsDocPropertyTags) {
					children.push(...n.jsDocPropertyTags);
				}
				children.push(n.jsDocTypeTag);
				break;
			}
			case ts.SyntaxKind.JSDocLiteralType: {
				const n = node as ts.JSDocLiteralType;
				children.push(n.literal);
				break;
			}
			case ts.SyntaxKind.SyntaxList: {
				const n = node as ts.SyntaxList;
				children.push(...n._children);
				break;
			}
			default:
				break;
		}
		for (const child of children) {
			if (child) {
				this.walkMostAST(child, visit);
			}
		}
	}

	didOpen(params: DidOpenTextDocumentParams) {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		return this.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didOpen(util.uri2path(uri), params.textDocument.text);
		});
	}

	didChange(params: DidChangeTextDocumentParams) {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		let text = null;
		params.contentChanges.forEach((change) => {
			if (change.range || change.rangeLength) {
				throw new Error('incremental updates in textDocument/didChange not supported for file ' + params.textDocument.uri);
			}
			text = change.text;
		});
		if (!text) {
			return;
		}
		this.projectManager.didChange(util.uri2path(uri), text);
	}

	didSave(params: DidSaveTextDocumentParams) {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		return this.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didSave(util.uri2path(uri));
		});
	}

	didClose(params: DidCloseTextDocumentParams) {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		return this.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didClose(util.uri2path(uri));
		});
	}

    /**
     * Fetches (or creates if needed) source file object for a given file name
     * @param configuration project configuration
     * @param fileName file name to fetch source file for or create it
     */
	private getSourceFile(configuration: pm.ProjectConfiguration, fileName: string): ts.SourceFile {
		const sourceFile = configuration.program.getSourceFile(fileName);
		if (sourceFile) {
			return sourceFile;
		}
		if (!this.projectManager.hasFile(fileName)) {
			return null;
		}
		configuration.host.addFile(fileName);
		// requery program object to synchonize LanguageService's data
		configuration.program = configuration.service.getProgram();
		return configuration.program.getSourceFile(fileName);
	}

    /**
     * Produces async function that converts ReferenceEntry object to Location
     */
	private transformReference(root: string, program: ts.Program, ref: ts.ReferenceEntry): AsyncFunction<Location, Error> {
		return (callback: (err?: Error, result?: Location) => void) => {
			const sourceFile = program.getSourceFile(ref.fileName);
			let start = ts.getLineAndCharacterOfPosition(sourceFile, ref.textSpan.start);
			let end = ts.getLineAndCharacterOfPosition(sourceFile, ref.textSpan.start + ref.textSpan.length);
			callback(null, Location.create(util.path2uri(root, ref.fileName), {
				start: start,
				end: end
			}));
		}
	}

    /**
     * Produces async function that converts NavigateToItem object to SymbolInformation
     */
	private transformNavItem(root: string, program: ts.Program, item: ts.NavigateToItem): AsyncFunction<SymbolInformation, Error> {
		return (callback: (err?: Error, result?: SymbolInformation) => void) => {
			const sourceFile = program.getSourceFile(item.fileName);
			let start = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start);
			let end = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start + item.textSpan.length);
			callback(null, SymbolInformation.create(item.name,
				util.convertStringtoSymbolKind(item.kind),
				Range.create(start.line, start.character, end.line, end.character),
				this.defUri(item.fileName), item.containerName));
		}
	}

    /**
     * Collects workspace symbols from all sub-projects until there are no more sub-projects left or we found enough items
     * @param query search query
     * @param limit max number of items to fetch (if greather than zero)
     * @param configurations array of project configurations
     * @param index configuration's index to process. Execution stops if there are no more configs to process or we collected enough items
     * @param items array to fill with the items found
     * @param callback callback to call when done
     */
	private collectWorkspaceSymbols(query: string,
		limit: number,
		configurations: pm.ProjectConfiguration[],
		index: number,
		items: SymbolInformation[],
		callback: () => void) {
		if (index >= configurations.length) {
			// safety first
			return callback();
		}
		const configuration = configurations[index];

		const maybeEnough = () => {
			if (limit && items.length >= limit || index == configurations.length - 1) {
				return callback();
			}
			this.collectWorkspaceSymbols(query, limit, configurations, index + 1, items, callback);
		};

		configuration.prepare().then(() => {
			setImmediate(() => {
				this.projectManager.syncConfiguration(configuration);
				const chunkSize = limit ? Math.min(limit, limit - items.length) : undefined;
				setImmediate(() => {
					if (query) {
						const chunk = configuration.service.getNavigateToItems(query, chunkSize, undefined, true);
						const tasks = [];
						chunk.forEach((item) => {
							tasks.push(this.transformNavItem(this.root, configuration.program, item));
						});
						async.parallel(tasks, (err: Error, results: SymbolInformation[]) => {
							Array.prototype.push.apply(items, results);
							maybeEnough();
						});
					} else {
						const chunk = this.getNavigationTreeItems(configuration, chunkSize);
						Array.prototype.push.apply(items, chunk);
						maybeEnough();
					}
				});
			});
		}, callback);
	}

    /**
     * Transforms definition's file name to URI. If definition belongs to TypeScript library,
     * returns git://github.com/Microsoft/TypeScript URL, otherwise returns file:// one
     */
	private defUri(filePath: string): string {
		filePath = util.normalizePath(filePath);
		if (pm.getTypeScriptLibraries().has(filePath)) {
			return 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/' + path_.basename(filePath);
		}
		return util.path2uri(this.root, filePath);
	}

    /**
     * Fetches up to limit navigation bar items from given project, flattens them
     */
	private getNavigationTreeItems(configuration: pm.ProjectConfiguration, limit?: number): SymbolInformation[] {
		const result = [];
		const libraries = pm.getTypeScriptLibraries();
		for (const sourceFile of configuration.program.getSourceFiles().sort((a, b) => a.fileName.localeCompare(b.fileName))) {
			// excluding navigation items from TypeScript libraries
			if (libraries.has(util.normalizePath(sourceFile.fileName))) {
				continue;
			}
			const tree = configuration.service.getNavigationTree(sourceFile.fileName);
			this.flattenNavigationTreeItem(tree, null, sourceFile, result, limit);
			if (limit && result.length >= limit) {
				break;
			}
		}
		return result;
	}

    /**
     * Flattens navigation tree by transforming it to one-dimensional array.
     * Some items (source files, modules) may be excluded 
     */
	private flattenNavigationTreeItem(item: ts.NavigationTree, parent: ts.NavigationTree, sourceFile: ts.SourceFile, result: SymbolInformation[], limit?: number) {
		if (!limit || result.length < limit) {
			const acceptable = TypeScriptService.isAcceptableNavigationTreeItem(item);
			if (acceptable) {
				result.push(this.transformNavigationTreeItem(item, parent, sourceFile));
			}
			if (item.childItems) {
				let i = 0;
				while (i < item.childItems.length && (!limit || result.length < limit)) {
					this.flattenNavigationTreeItem(item.childItems[i], acceptable ? item : null, sourceFile, result, limit);
					i++;
				}
			}
		}
	}

    /**
     * Transforms NavigationTree to SymbolInformation
     */
	private transformNavigationTreeItem(item: ts.NavigationTree, parent: ts.NavigationTree, sourceFile: ts.SourceFile): SymbolInformation {
		const span = item.spans[0];
		let start = ts.getLineAndCharacterOfPosition(sourceFile, span.start);
		let end = ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length);
		return SymbolInformation.create(item.text,
			util.convertStringtoSymbolKind(item.kind),
			Range.create(start.line, start.character, end.line, end.character),
			this.defUri(sourceFile.fileName), parent ? parent.text : '');
	}

    /**
     * @return true if navigation tree item is acceptable for inclusion into workspace/symbols 
     */
	private static isAcceptableNavigationTreeItem(item: ts.NavigationTree): boolean {
		// modules and source files should be excluded
		if ([ts.ScriptElementKind.moduleElement, "sourcefile"].indexOf(item.kind) >= 0) {
			return false;
		}
		// special items may start with ", (, [, or <
		if (/^[<\(\[\"]/.test(item.text)) {
			return false;
		}
		// magic words
		if (["default", "constructor", "new()"].indexOf(item.text) >= 0) {
			return false;
		}
		return true;
	}

}
