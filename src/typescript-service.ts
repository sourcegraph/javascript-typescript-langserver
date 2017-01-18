import * as path_ from 'path';
import * as ts from 'typescript';
import {
	InitializeParams,
	InitializeResult,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	ReferenceParams,
	Location,
	Hover,
	DocumentSymbolParams,
	SymbolInformation,
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
	private traceModuleResolution: boolean;

	constructor(traceModuleResolution?: boolean) {
		this.traceModuleResolution = traceModuleResolution || false;
	}

	initialize(params: InitializeParams, remoteFs: FileSystem.FileSystem, strict: boolean): Promise<InitializeResult> {
		if (this.initialized) {
			return this.initialized;
		}
		this.initialized = new Promise<InitializeResult>((resolve) => {
			if (params.rootPath) {
				this.root = util.uri2path(params.rootPath);
				this.strict = strict;
				this.projectManager = new pm.ProjectManager(this.root, remoteFs, strict, this.traceModuleResolution);

				this.projectManager.ensureFilesForWorkspaceSymbol(); // pre-fetching

				resolve({
					capabilities: {
						// Tell the client that the server works in FULL text document sync mode
						textDocumentSync: TextDocumentSyncKind.Full,
						hoverProvider: true,
						definitionProvider: true,
						referencesProvider: true,
						documentSymbolProvider: true,
						workspaceSymbolProvider: true,
						xworkspaceReferencesProvider: true,
						xdefinitionProvider: true,
						xdependenciesProvider: true,
					}
				})
			}
		});
		return this.initialized;
	}

	shutdown(): Promise<void> { return Promise.resolve(); }

	async getDefinition(params: TextDocumentPositionParams): Promise<Location[]> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		const line = params.position.line;
		const column = params.position.character;
		await this.projectManager.ensureFilesForHoverAndDefinition(uri);

		const fileName: string = util.uri2path(uri);
		const configuration = this.projectManager.getConfiguration(fileName);
		await configuration.ensureBasicFiles();

		const sourceFile = this.getSourceFile(configuration, fileName);
		if (!sourceFile) {
			return [];
		}

		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
		const defs: ts.DefinitionInfo[] = configuration.getService().getDefinitionAtPosition(fileName, offset);
		const ret = [];
		if (defs) {
			for (let def of defs) {
				const sourceFile = this.getSourceFile(configuration, def.fileName);
				if (!sourceFile) {
					throw new Error('expected source file "' + def.fileName + '" to exist in configuration');
				}
				const start = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
				const end = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start + def.textSpan.length);
				ret.push(Location.create(this.defUri(def.fileName), {
					start: start,
					end: end
				}));
			}
		}
		return ret;
	}

	async getXdefinition(params: TextDocumentPositionParams): Promise<rt.SymbolLocationInformation[]> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		const line = params.position.line;
		const column = params.position.character;
		await this.projectManager.ensureFilesForHoverAndDefinition(uri);

		const fileName: string = util.uri2path(uri);
		const configuration = this.projectManager.getConfiguration(fileName);
		await configuration.ensureBasicFiles();

		const sourceFile = this.getSourceFile(configuration, fileName);
		if (!sourceFile) {
			return [];
		}

		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
		const defs: ts.DefinitionInfo[] = configuration.getService().getDefinitionAtPosition(fileName, offset);
		const ret = [];
		if (defs) {
			for (let def of defs) {
				const sourceFile = this.getSourceFile(configuration, def.fileName);
				if (!sourceFile) {
					throw new Error('expected source file "' + def.fileName + '" to exist in configuration');
				}
				const start = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
				const end = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start + def.textSpan.length);
				const loc = Location.create(this.defUri(def.fileName), {
					start: start,
					end: end
				});
				ret.push({
					symbol: util.defInfoToSymbolDescriptor(def),
					location: loc,
				});
			}
		}
		return ret;
	}

	async getHover(params: TextDocumentPositionParams): Promise<Hover | null> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root)
		const line = params.position.line;
		const column = params.position.character;
		await this.projectManager.ensureFilesForHoverAndDefinition(uri)

		const fileName: string = util.uri2path(uri);
		const configuration = this.projectManager.getConfiguration(fileName);
		await configuration.ensureBasicFiles();

		let sourceFile = this.getSourceFile(configuration, fileName);
		if (!sourceFile) {
			return null;
		}
		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
		const info = configuration.getService().getQuickInfoAtPosition(fileName, offset);
		if (!info) {
			return null;
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

		return { contents: contents, range: Range.create(start.line, start.character, end.line, end.character) };
	}

	async getReferences(params: ReferenceParams): Promise<Location[]> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root)
		const line = params.position.line;
		const column = params.position.character;
		const fileName: string = util.uri2path(uri);

		await this.projectManager.ensureFilesForReferences(uri);

		const configuration = this.projectManager.getConfiguration(fileName);
		await configuration.ensureAllFiles();

		const sourceFile = this.getSourceFile(configuration, fileName);
		if (!sourceFile) {
			return [];
		}

		const started = new Date().getTime();
		const prepared = new Date().getTime();

		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
		const refs = configuration.getService().getReferencesAtPosition(fileName, offset);

		const fetched = new Date().getTime();
		const tasks: AsyncFunction<Location, Error>[] = [];

		if (refs) {
			for (let ref of refs) {
				tasks.push(this.transformReference(this.root,
					configuration.getProgram(),
					params.context && params.context.includeDeclaration,
					ref));
			}
		}
		return new Promise<Location[]>((resolve, reject) => {
			async.parallel(tasks, (err: Error, results: Location[]) => {
				const finished = new Date().getTime();
				console.error('references', 'transform', (finished - fetched) / 1000.0, 'fetch', (fetched - prepared) / 1000.0, 'prepare', (prepared - started) / 1000.0);
				return resolve(results.filter(item => item));
			});
		});
	}

	async getWorkspaceSymbols(params: rt.WorkspaceSymbolParamsWithLimit): Promise<SymbolInformation[]> {
		const query = params.query;
		const limit = params.limit;

		await this.projectManager.ensureFilesForWorkspaceSymbol();

		if (!query && this.emptyQueryWorkspaceSymbols) {
			return this.emptyQueryWorkspaceSymbols;
		}
		const configs = this.projectManager.getConfigurations();
		const itemsPromise = this.collectWorkspaceSymbols(query, configs);
		if (!query) {
			this.emptyQueryWorkspaceSymbols = itemsPromise;
		}
		return (await itemsPromise).slice(0, limit);
	}

	async getDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		await this.projectManager.ensureFilesForHoverAndDefinition(uri);
		const fileName = util.uri2path(uri);

		const config = this.projectManager.getConfiguration(uri);
		await config.ensureBasicFiles();
		const sourceFile = this.getSourceFile(config, fileName);
		if (!sourceFile) {
			return [];
		}
		const tree = config.getService().getNavigationTree(fileName);
		const result: SymbolInformation[] = [];
		this.flattenNavigationTreeItem(tree, null, sourceFile, result);
		return Promise.resolve(result);
	}

	async getWorkspaceReference(params: rt.WorkspaceReferenceParams): Promise<rt.ReferenceInformation[]> {
		const refInfo: rt.ReferenceInformation[] = [];

		await this.projectManager.ensureAllFiles();

		const configs = this.projectManager.getConfigurations();
		await Promise.all(configs.map(async (config) => {
			if (params.hints && params.hints.dependeePackageName && params.hints.dependeePackageName !== config.getPackageName()) {
				return;
			}

			await config.ensureAllFiles();

			const files = config.getService().getProgram().getSourceFiles().sort((a, b) => a.fileName.localeCompare(b.fileName));
			for (const source of files) {
				// ignore dependency files
				if (util.normalizePath(source.fileName).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
					continue;
				}

				this.walkMostAST(source, (node) => {
					switch (node.kind) {
						case ts.SyntaxKind.Identifier: { // include all matching refs at the node
							const defs = config.getService().getDefinitionAtPosition(source.fileName, node.pos + 1);
							if (!defs) {
								break;
							}
							for (const def of defs) {
								const sd = util.defInfoToSymbolDescriptor(def);
								if (!util.symbolDescriptorMatch(params.query, sd)) {
									continue;
								}
								const start = ts.getLineAndCharacterOfPosition(source, node.pos);
								const end = ts.getLineAndCharacterOfPosition(source, node.end);
								const loc = {
									uri: this.defUri(source.fileName),
									range: {
										start: start,
										end: end,
									},
								};
								refInfo.push({
									symbol: sd,
									reference: loc,
								});
							}
							break;
						}
						case ts.SyntaxKind.StringLiteral: {
							// TODO: include string-interpolated references
							break;
						}
					}
				});
			}

		}));

		return refInfo;
	}

	async getDependencies(): Promise<rt.DependencyReference[]> {
		await this.projectManager.ensureModuleStructure();

		const pkgFiles: string[] = [];
		pm.walkInMemoryFs(this.projectManager.getFs(), "/", (path: string, isdir: boolean): Error | void => {
			if (isdir && path_.basename(path) === "node_modules") {
				return pm.skipDir;
			}
			if (isdir) {
				return;
			}
			if (path_.basename(path) !== "package.json") {
				return;
			}
			pkgFiles.push(path);
		});

		const deps: rt.DependencyReference[] = [];
		const pkgJsons = pkgFiles.map((p) => JSON.parse(this.projectManager.getFs().readFile(p)));
		for (const pkgJson of pkgJsons) {
			const pkgName = pkgJson['name'];
			for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) {
				if (pkgJson[k]) {
					for (const name in pkgJson[k]) {
						deps.push({ attributes: { 'name': name, 'version': pkgJson[k][name] }, hints: { dependeePackageName: pkgName } });
					}
				}
			}
		}
		return deps;
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
				pushall(children, n.name, n.constraint, n.expression);
				break;
			}
			case ts.SyntaxKind.Parameter: {
				const n = node as ts.ParameterDeclaration;
				pushall(children, n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.Decorator: {
				const n = node as ts.Decorator;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.PropertySignature: {
				const n = node as ts.PropertySignature;
				pushall(children, n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.PropertyDeclaration: {
				const n = node as ts.PropertyDeclaration;
				pushall(children, n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.MethodSignature: {
				const n = node as ts.MethodSignature;
				pushall(children, n.name, n.type);
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
				pushall(children, n.name, n.body);
				break;
			}
			case ts.SyntaxKind.Constructor: {
				const n = node as ts.ConstructorDeclaration;
				pushall(children, n.name, n.body);
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
				pushall(children, n.name, n.type);
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
				pushall(children, n.name, n.type);
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
				pushall(children, n.name, n.type);
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
				pushall(children, n.name, n.type);
				pushall(children, n.name, n.type);
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
				pushall(children, n.name);
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
				pushall(children, n.propertyName, n.name, n.initializer);
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
				pushall(children, n.expression, n.argumentExpression);
				break;
			}
			case ts.SyntaxKind.CallExpression: {
				const n = node as ts.CallExpression;
				pushall(children, n.name, n.expression, ...n.arguments);
				if (n.typeArguments) {
					children.push(...n.typeArguments);
				}
				break;
			}
			case ts.SyntaxKind.NewExpression: {
				const n = node as ts.NewExpression;
				pushall(children, n.name, n.expression, ...n.arguments);
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
				pushall(children, n.name, n.body);
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
				pushall(children, n.expression);
				break;
			}
			case ts.SyntaxKind.SpreadElementExpression: {
				const n = node as ts.SpreadElementExpression;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.ClassExpression: {
				const n = node as ts.ClassExpression;
				pushall(children, n.name, ...n.members);
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
				if (n.name) {
					children.push(n.name);
				}
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
				pushall(children, n.expression, n.thenStatement, n.elseStatement);
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
				pushall(children, n.initializer, n.condition, n.incrementor, n.statement);
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
				if (n.label) {
					children.push(n.label);
				}
				break;
			}
			case ts.SyntaxKind.BreakStatement: {
				const n = node as ts.BreakStatement;
				if (n.label) {
					children.push(n.label);
				}
				break;
			}
			case ts.SyntaxKind.ReturnStatement: {
				const n = node as ts.ReturnStatement;
				if (n.expression) {
					children.push(n.expression);
				}
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
				pushall(children, n.tryBlock, n.catchClause, n.finallyBlock);
				break;
			}
			case ts.SyntaxKind.VariableDeclaration: {
				const n = node as ts.VariableDeclaration;
				pushall(children, n.name, n.type, n.initializer);
				break;
			}
			case ts.SyntaxKind.VariableDeclarationList: {
				const n = node as ts.VariableDeclarationList;
				children.push(...n.declarations);
				break;
			}
			case ts.SyntaxKind.FunctionDeclaration: {
				const n = node as ts.FunctionDeclaration;
				pushall(children, n.name, n.body, n.type, ...n.parameters);
				if (n.typeParameters) {
					children.push(...n.typeParameters);
				}
				break;
			}
			case ts.SyntaxKind.ClassDeclaration: {
				const n = node as ts.ClassDeclaration;
				pushall(children, n.name, ...n.members);
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
				pushall(children, n.name, n.body);
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
				pushall(children, n.importClause, n.moduleSpecifier);
				break;
			}
			case ts.SyntaxKind.ImportClause: {
				const n = node as ts.ImportClause;
				pushall(children, n.name, n.namedBindings);
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
				pushall(children, n.propertyName, n.name);
				break;
			}
			case ts.SyntaxKind.ExportAssignment: {
				const n = node as ts.ExportAssignment;
				pushall(children, n.name, n.expression);
				break;
			}
			case ts.SyntaxKind.ExportDeclaration: {
				const n = node as ts.ExportDeclaration;
				pushall(children, n.exportClause, n.moduleSpecifier, n.name);
				break;
			}
			case ts.SyntaxKind.NamedExports: {
				const n = node as ts.NamedExports;
				children.push(...n.elements);
				break;
			}
			case ts.SyntaxKind.ExportSpecifier: {
				const n = node as ts.ExportSpecifier;
				pushall(children, n.propertyName, n.name);
				break;
			}
			case ts.SyntaxKind.MissingDeclaration: {
				const n = node as ts.MissingDeclaration;
				if (n.name) {
					children.push(n.name);
				}
				break;
			}
			case ts.SyntaxKind.ExternalModuleReference: {
				const n = node as ts.ExternalModuleReference;
				pushall(children, n.expression);
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
				pushall(children, n.name, n.initializer);
				break;
			}
			case ts.SyntaxKind.JsxSpreadAttribute: {
				const n = node as ts.JsxSpreadAttribute;
				children.push(n.expression);
				break;
			}
			case ts.SyntaxKind.JsxExpression: {
				const n = node as ts.JsxExpression;
				if (n.expression) {
					children.push(n.expression);
				}
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
				pushall(children, n.name, n.objectAssignmentInitializer);
				break;
			}
			case ts.SyntaxKind.EnumMember: {
				const n = node as ts.EnumMember;
				pushall(children, n.name, n.initializer);
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
				pushall(children, n.name, n.type, n.initializer);
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
				pushall(children, n.name, n.type, ...n.parameters);
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
				pushall(children, n.typeExpression, n.postParameterName, n.parameterName);
				if (n.preParameterName) {
					children.push(n.preParameterName);
				}
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
				pushall(children, n.fullName, n.typeExpression, n.jsDocTypeLiteral);
				if (n.name) {
					children.push(n.name);
				}
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
				if (n.jsDocTypeTag) {
					children.push(n.jsDocTypeTag);
				}
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

	didOpen(params: DidOpenTextDocumentParams): Promise<void> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		return this.projectManager.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didOpen(util.uri2path(uri), params.textDocument.text);
		});
	}

	async didChange(params: DidChangeTextDocumentParams): Promise<void> {
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

	didSave(params: DidSaveTextDocumentParams): Promise<void> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		return this.projectManager.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didSave(util.uri2path(uri));
		});
	}

	didClose(params: DidCloseTextDocumentParams): Promise<void> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		return this.projectManager.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didClose(util.uri2path(uri));
		});
	}

    /**
     * Fetches (or creates if needed) source file object for a given file name
     * @param configuration project configuration
     * @param fileName file name to fetch source file for or create it
     */
	private getSourceFile(configuration: pm.ProjectConfiguration, fileName: string): ts.SourceFile | null {
		const sourceFile = configuration.getProgram().getSourceFile(fileName);
		if (sourceFile) {
			return sourceFile;
		}
		if (!this.projectManager.hasFile(fileName)) {
			return null;
		}
		configuration.getHost().addFile(fileName);
		configuration.syncProgram();

		return configuration.getProgram().getSourceFile(fileName);
	}

    /**
     * Produces async function that converts ReferenceEntry object to Location
     */
	private transformReference(root: string,
		program: ts.Program,
		includeDeclaration: boolean,
		ref: ts.ReferenceEntry): AsyncFunction<Location, Error> {
		return (callback: (err?: Error, result?: Location) => void) => {
			if (!includeDeclaration && ref.isDefinition) {
				return callback(null);
			}
			const sourceFile = program.getSourceFile(ref.fileName);
			if (!sourceFile) {
				return callback(new Error('source file "' + ref.fileName + '" does not exist'));
			}
			let start = ts.getLineAndCharacterOfPosition(sourceFile, ref.textSpan.start);
			let end = ts.getLineAndCharacterOfPosition(sourceFile, ref.textSpan.start + ref.textSpan.length);
			callback(undefined, Location.create(util.path2uri(root, ref.fileName), {
				start: start,
				end: end
			}));
		}
	}

    /**
     * transformNavItem transforms a NavigateToItem instance to a SymbolInformation instance
     */
	private transformNavItem(root: string, program: ts.Program, item: ts.NavigateToItem): SymbolInformation {
		const sourceFile = program.getSourceFile(item.fileName);
		if (!sourceFile) {
			throw new Error('source file "' + item.fileName + '" does not exist');
		}
		let start = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start);
		let end = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start + item.textSpan.length);
		return SymbolInformation.create(item.name,
			util.convertStringtoSymbolKind(item.kind),
			Range.create(start.line, start.character, end.line, end.character),
			this.defUri(item.fileName), item.containerName);
	}

	private async collectWorkspaceSymbols(query: string, configs: pm.ProjectConfiguration[]): Promise<SymbolInformation[]> {
		const configSymbols: SymbolInformation[][] = await Promise.all(
			configs.map(async (config) => {
				const symbols: SymbolInformation[] = [];
				await config.ensureAllFiles();
				if (query) {
					const items = config.getService().getNavigateToItems(query, undefined, undefined, true);
					for (const item of items) {
						symbols.push(this.transformNavItem(this.root, config.getProgram(), item));
					}
				} else {
					Array.prototype.push.apply(symbols, this.getNavigationTreeItems(config));
				}
				return symbols;
			})
		);
		const symbols: SymbolInformation[] = [];
		for (const cs of configSymbols) {
			Array.prototype.push.apply(symbols, cs);
		}

		if (!query) {
			return symbols.sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()));
		}
		return symbols;
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
		const result: SymbolInformation[] = [];
		const libraries = pm.getTypeScriptLibraries();
		for (const sourceFile of configuration.getProgram().getSourceFiles().sort((a, b) => a.fileName.localeCompare(b.fileName))) {
			// excluding navigation items from TypeScript libraries
			if (libraries.has(util.normalizePath(sourceFile.fileName))) {
				continue;
			}
			const tree = configuration.getService().getNavigationTree(sourceFile.fileName);
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
	private flattenNavigationTreeItem(item: ts.NavigationTree, parent: ts.NavigationTree | null, sourceFile: ts.SourceFile, result: SymbolInformation[], limit?: number) {
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
	private transformNavigationTreeItem(item: ts.NavigationTree, parent: ts.NavigationTree | null, sourceFile: ts.SourceFile): SymbolInformation {
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

function pushall<T>(arr: T[], ...elems: (T | null | undefined)[]): number {
	for (const e of elems) {
		if (e) {
			arr.push(e);
		}
	}
	return arr.length;
}
