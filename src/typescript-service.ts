import { Observable } from '@reactivex/rxjs';
import iterate from 'iterare';
import { toPairs } from 'lodash';
import { Span } from 'opentracing';
import * as path_ from 'path';
import * as ts from 'typescript';
import * as url from 'url';
import {
	CompletionItem,
	CompletionItemKind,
	CompletionList,
	DidChangeTextDocumentParams,
	DidCloseTextDocumentParams,
	DidOpenTextDocumentParams,
	DidSaveTextDocumentParams,
	DocumentSymbolParams,
	Hover,
	InitializeResult,
	Location,
	MarkedString,
	ParameterInformation,
	Range,
	ReferenceParams,
	SignatureHelp,
	SignatureInformation,
	SymbolInformation,
	TextDocumentPositionParams,
	TextDocumentSyncKind
} from 'vscode-languageserver';
import { FileSystem, FileSystemUpdater, LocalFileSystem, RemoteFileSystem } from './fs';
import { LanguageClient } from './lang-handler';
import { Logger, LSPLogger } from './logging';
import { InMemoryFileSystem, isTypeScriptLibrary } from './memfs';
import * as pm from './project-manager';
import {
	DependencyReference,
	InitializeParams,
	PackageDescriptor,
	PackageInformation,
	ReferenceInformation,
	SymbolDescriptor,
	SymbolLocationInformation,
	WorkspaceReferenceParams,
	WorkspaceSymbolParams
} from './request-type';
import * as util from './util';

export interface TypeScriptServiceOptions {
	traceModuleResolution?: boolean;
	strict?: boolean;
}

export type TypeScriptServiceFactory = (client: LanguageClient, options?: TypeScriptServiceOptions) => TypeScriptService;

/**
 * Handles incoming requests and return responses. There is a one-to-one-to-one
 * correspondence between TCP connection, TypeScriptService instance, and
 * language workspace. TypeScriptService caches data from the compiler across
 * requests. The lifetime of the TypeScriptService instance is tied to the
 * lifetime of the TCP connection, so its caches are deleted after the
 * connection is torn down.
 *
 * Methods are camelCase versions of the LSP spec methods and dynamically
 * dispatched. Methods not to be exposed over JSON RPC are prefixed with an
 * underscore.
 */
export class TypeScriptService {

	projectManager: pm.ProjectManager;

	/**
	 * The rootPath as passed to `initialize` or converted from `rootUri`
	 */
	root: string;

	/**
	 * The root URI as passed to `initialize` or converted from `rootPath`
	 */
	protected rootUri: string;

	/**
	 * Cached response for empty workspace/symbol query
	 */
	private emptyQueryWorkspaceSymbols: SymbolInformation[];

	private traceModuleResolution: boolean;

	/**
	 * The remote (or local), asynchronous, file system to fetch files from
	 */
	protected fileSystem: FileSystem;

	protected logger: Logger;

	/**
	 * Holds file contents and workspace structure in memory
	 */
	protected inMemoryFileSystem: InMemoryFileSystem;

	/**
	 * Syncs the remote file system with the in-memory file system
	 */
	protected updater: FileSystemUpdater;

	constructor(protected client: LanguageClient, protected options: TypeScriptServiceOptions = {}) {
		this.logger = new LSPLogger(client);
	}

	/**
	 * The initialize request is sent as the first request from the client to the server. If the
	 * server receives request or notification before the `initialize` request it should act as
	 * follows:
	 *
	 * - for a request the respond should be errored with `code: -32002`. The message can be picked by
	 * the server.
	 * - notifications should be dropped, except for the exit notification. This will allow the exit a
	 * server without an initialize request.
	 *
	 * Until the server has responded to the `initialize` request with an `InitializeResult` the
	 * client must not sent any additional requests or notifications to the server.
	 *
	 * During the `initialize` request the server is allowed to sent the notifications
	 * `window/showMessage`, `window/logMessage` and `telemetry/event` as well as the
	 * `window/showMessageRequest` request to the client.
	 */
	async initialize(params: InitializeParams, span = new Span()): Promise<InitializeResult> {
		if (params.rootUri || params.rootPath) {
			this.root = params.rootPath || util.uri2path(params.rootUri!);
			this.rootUri = params.rootUri || util.path2uri('', params.rootPath!);
			this._initializeFileSystems(!this.options.strict && !(params.capabilities.xcontentProvider && params.capabilities.xfilesProvider));
			this.updater = new FileSystemUpdater(this.fileSystem, this.inMemoryFileSystem);
			this.projectManager = new pm.ProjectManager(this.root, this.inMemoryFileSystem, this.updater, !!this.options.strict, this.traceModuleResolution, this.logger);
			// Pre-fetch files in the background
			this.projectManager.ensureOwnFiles(span).catch(err => {
				this.logger.error('Background fetching failed ', err);
			});
		}
		return {
			capabilities: {
				// Tell the client that the server works in FULL text document sync mode
				textDocumentSync: TextDocumentSyncKind.Full,
				hoverProvider: true,
				signatureHelpProvider: {
					triggerCharacters: ['(', ',']
				},
				definitionProvider: true,
				referencesProvider: true,
				documentSymbolProvider: true,
				workspaceSymbolProvider: true,
				xworkspaceReferencesProvider: true,
				xdefinitionProvider: true,
				xdependenciesProvider: true,
				completionProvider: {
					resolveProvider: false,
					triggerCharacters: ['.']
				},
				xpackagesProvider: true
			}
		};
	}

	/**
	 * Initializes the remote file system and in-memory file system.
	 * Can be overridden
	 *
	 * @param accessDisk Whether the language server is allowed to access the local file system
	 */
	protected _initializeFileSystems(accessDisk: boolean): void {
		this.fileSystem = accessDisk ? new LocalFileSystem(util.uri2path(this.root)) : new RemoteFileSystem(this.client);
		this.inMemoryFileSystem = new InMemoryFileSystem(this.root);
	}

	/**
	 * The shutdown request is sent from the client to the server. It asks the server to shut down,
	 * but to not exit (otherwise the response might not be delivered correctly to the client).
	 * There is a separate exit notification that asks the server to exit.
	 */
	async shutdown(params = {}, span = new Span()): Promise<null> {
		this.projectManager.dispose();
		return null;
	}

	/**
	 * The goto definition request is sent from the client to the server to resolve the definition
	 * location of a symbol at a given text document position.
	 */
	async textDocumentDefinition(params: TextDocumentPositionParams, span = new Span()): Promise<Location[]> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		const line = params.position.line;
		const column = params.position.character;

		// Fetch files needed to resolve definition
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span).toPromise();

		const fileName: string = util.uri2path(uri);
		const configuration = this.projectManager.getConfiguration(fileName);
		configuration.ensureBasicFiles();

		const sourceFile = this._getSourceFile(configuration, fileName);
		if (!sourceFile) {
			return [];
		}

		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
		const defs: ts.DefinitionInfo[] = configuration.getService().getDefinitionAtPosition(fileName, offset);
		const ret = [];
		if (defs) {
			for (const def of defs) {
				const sourceFile = this._getSourceFile(configuration, def.fileName);
				if (!sourceFile) {
					throw new Error('expected source file "' + def.fileName + '" to exist in configuration');
				}
				const start = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
				const end = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start + def.textSpan.length);
				ret.push(Location.create(this._defUri(def.fileName), {
					start,
					end
				}));
			}
		}
		return ret;
	}

	async textDocumentXdefinition(params: TextDocumentPositionParams, span = new Span()): Promise<SymbolLocationInformation[]> {

		// Ensure files needed to resolve SymbolLocationInformation are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span).toPromise();

		const fileName: string = util.uri2path(params.textDocument.uri);
		const configuration = this.projectManager.getConfiguration(fileName);
		configuration.ensureBasicFiles();

		const sourceFile = this._getSourceFile(configuration, fileName);
		if (!sourceFile) {
			return [];
		}

		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
		const defs: ts.DefinitionInfo[] = configuration.getService().getDefinitionAtPosition(fileName, offset);
		const ret = [];
		if (defs) {
			for (const def of defs) {
				const sourceFile = this._getSourceFile(configuration, def.fileName);
				if (!sourceFile) {
					throw new Error('expected source file "' + def.fileName + '" to exist in configuration');
				}
				const start = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
				const end = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start + def.textSpan.length);
				const loc = Location.create(this._defUri(def.fileName), {
					start,
					end
				});
				ret.push({
					symbol: util.defInfoToSymbolDescriptor(def),
					location: loc
				});
			}
		}
		return ret;
	}

	/**
	 * The hover request is sent from the client to the server to request hover information at a
	 * given text document position.
	 */
	async textDocumentHover(params: TextDocumentPositionParams, span = new Span()): Promise<Hover> {

		// Ensure files needed to resolve hover are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span).toPromise();

		const fileName: string = util.uri2path(params.textDocument.uri);
		const configuration = this.projectManager.getConfiguration(fileName);
		configuration.ensureBasicFiles();

		const sourceFile = this._getSourceFile(configuration, fileName);
		if (!sourceFile) {
			throw new Error(`Unknown text document ${params.textDocument.uri}`);
		}
		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
		const info = configuration.getService().getQuickInfoAtPosition(fileName, offset);
		if (!info) {
			return { contents: [] };
		}
		const contents: MarkedString[] = [{
			language: 'typescript',
			value: ts.displayPartsToString(info.displayParts)
		}];
		const documentation = ts.displayPartsToString(info.documentation);
		if (documentation) {
			contents.push(documentation);
		}
		const start = ts.getLineAndCharacterOfPosition(sourceFile, info.textSpan.start);
		const end = ts.getLineAndCharacterOfPosition(sourceFile, info.textSpan.start + info.textSpan.length);

		return { contents, range: Range.create(start.line, start.character, end.line, end.character) };
	}

	/**
	 * The references request is sent from the client to the server to resolve project-wide
	 * references for the symbol denoted by the given text document position.
	 */
	textDocumentReferences(params: ReferenceParams, span = new Span()): Observable<Location[]> {
		// Ensure all files were fetched to collect all references
		return Observable.from(this.projectManager.ensureOwnFiles(span))
			.mergeMap(() => {
				// Convert URI to file path because TypeScript doesn't work with URIs
				const fileName = util.uri2path(params.textDocument.uri);
				// Get tsconfig configuration for requested file
				const configuration = this.projectManager.getConfiguration(fileName);
				// Ensure all files have been added
				configuration.ensureAllFiles();
				// Get SourceFile object for requested file
				const sourceFile = this._getSourceFile(configuration, fileName);
				if (!sourceFile) {
					throw new Error(`Source file ${fileName} does not exist`);
				}
				// Convert line/character to offset
				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
				// Request references at position from TypeScript
				// Despite the signature, getReferencesAtPosition() can return undefined
				return Observable.from(configuration.getService().getReferencesAtPosition(fileName, offset) || [])
					// Filter declaration if not requested
					.filter(reference => !reference.isDefinition || (params.context && params.context.includeDeclaration))
					// Map to Locations
					.map(reference => {
						const sourceFile = configuration.getProgram().getSourceFile(reference.fileName);
						if (!sourceFile) {
							throw new Error(`Source file ${reference.fileName} does not exist`);
						}
						// Convert offset to line/character position
						const start = ts.getLineAndCharacterOfPosition(sourceFile, reference.textSpan.start);
						const end = ts.getLineAndCharacterOfPosition(sourceFile, reference.textSpan.start + reference.textSpan.length);
						return {
							uri: util.path2uri(this.root, reference.fileName),
							range: {
								start,
								end
							}
						};
					});
			})
			.toArray();
	}

	/**
	 * The workspace symbol request is sent from the client to the server to list project-wide
	 * symbols matching the query string. The text document parameter specifies the active document
	 * at time of the query. This can be used to rank or limit results.
	 */
	async workspaceSymbol(params: WorkspaceSymbolParams, span = new Span()): Promise<SymbolInformation[]> {

		// Always return max. 50 results
		// TODO stream 50 results, then re-query and stream the rest
		const limit = Math.min(params.limit || Infinity, 50);

		const query = params.query;
		const symbolQuery = params.symbol ? Object.assign({}, params.symbol) : undefined;

		if (symbolQuery && symbolQuery.package) {
			symbolQuery.package = { name: symbolQuery.package.name };
		}

		if (symbolQuery) {
			try {
				const dtRes = await this._workspaceSymbolDefinitelyTyped({ ...params, limit });
				if (dtRes) {
					return dtRes;
				}
			} catch (err) {
				// Ignore
			}

			if (!symbolQuery.containerKind) {
				// symbolQuery.containerKind is sometimes empty when symbol.containerKind = 'module'
				symbolQuery.containerKind = undefined;
			}
		}

		// A workspace/symol request searches all symbols in own code, but not in dependencies
		await this.projectManager.ensureOwnFiles(span);

		// Cache result for empty query
		if (!query && !symbolQuery && this.emptyQueryWorkspaceSymbols) {
			return this.emptyQueryWorkspaceSymbols;
		}

		// Find configurations to search
		let configs: Iterable<pm.ProjectConfiguration>;
		if (symbolQuery && symbolQuery.package && symbolQuery.package.name) {
			// If PackageDescriptor is given, only search project with the matching package name
			configs = iterate(this.projectManager.configurations())
				.filter(config => config.getPackageName() === symbolQuery.package!.name);
		} else {
			const rootConfig = this.projectManager.getConfiguration('');
			if (rootConfig) {
				// Use root configuration because it includes all files
				configs = [rootConfig];
			} else {
				// Use all configurations
				configs = this.projectManager.configurations();
			}
		}
		const symbols = iterate(configs)
			.map(config => this._collectWorkspaceSymbols(config, query || symbolQuery, limit))
			.flatten<SymbolInformation>()
			.take(limit)
			.toArray();
		// Save empty query result
		if (!query && !symbolQuery) {
			this.emptyQueryWorkspaceSymbols = symbols;
		}
		return symbols;
	}

	protected async _workspaceSymbolDefinitelyTyped(params: WorkspaceSymbolParams): Promise<SymbolInformation[] | null> {
		const rootUriParts = url.parse(this.rootUri);
		if (!rootUriParts.pathname) {
			return null;
		}
		const packageJsonUri = url.format({ ...rootUriParts, pathname: path_.posix.join(rootUriParts.pathname, 'package.json') });
		await this.updater.ensure(packageJsonUri);
		const rootConfig = JSON.parse(this.inMemoryFileSystem.getContent(packageJsonUri));
		if (rootConfig.name !== 'definitely-typed') {
			return null;
		}
		if (!params.symbol || !params.symbol.package) {
			return null;
		}
		const pkg = params.symbol.package;
		if (!pkg.name || !pkg.name.startsWith('@types/')) {
			return null;
		}
		const relPkgRoot = pkg.name.slice('@types/'.length);
		await this.projectManager.ensureModuleStructure();

		const symbolQuery = params.symbol ? Object.assign({}, params.symbol) : undefined;
		if (symbolQuery) {
			symbolQuery.package = undefined;
			if (!symbolQuery.containerKind) {
				symbolQuery.containerKind = undefined; // symQuery.containerKind is sometimes empty when symbol.containerKind = 'module'
			}
		}

		const config = this.projectManager.getConfiguration(relPkgRoot);
		return Array.from(this._collectWorkspaceSymbols(config, params.query || symbolQuery, params.limit));
	}

	/**
	 * The document symbol request is sent from the client to the server to list all symbols found
	 * in a given text document.
	 */
	async textDocumentDocumentSymbol(params: DocumentSymbolParams, span = new Span()): Promise<SymbolInformation[]> {

		// Ensure files needed to resolve symbols are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span).toPromise();

		const fileName = util.uri2path(params.textDocument.uri);

		const config = this.projectManager.getConfiguration(fileName);
		config.ensureBasicFiles();
		const sourceFile = this._getSourceFile(config, fileName);
		if (!sourceFile) {
			return [];
		}
		const tree = config.getService().getNavigationTree(fileName);
		return Array.from(this._flattenNavigationTreeItem(tree, null, sourceFile));
	}

	/**
	 * The workspace references request is sent from the client to the server to locate project-wide
	 * references to a symbol given its description / metadata.
	 */
	async workspaceXreferences(params: WorkspaceReferenceParams, span = new Span()): Promise<ReferenceInformation[]> {
		const refInfo: ReferenceInformation[] = [];

		await this.projectManager.ensureAllFiles(span);

		const configs = this.projectManager.configurations();
		await Promise.all(iterate(configs).map(async config => {
			if (params.hints && params.hints.dependeePackageName && params.hints.dependeePackageName !== config.getPackageName()) {
				return;
			}

			config.ensureAllFiles();

			const files = config.getService().getProgram().getSourceFiles().sort((a, b) => a.fileName.localeCompare(b.fileName));
			for (const source of files) {
				// ignore dependency files
				if (util.toUnixPath(source.fileName).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
					continue;
				}

				this._walkMostAST(source, node => {
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
									uri: this._defUri(source.fileName),
									range: {
										start,
										end
									}
								};
								refInfo.push({
									symbol: sd,
									reference: loc
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

	/**
	 * This method returns metadata about the package(s) defined in a workspace and a list of
	 * dependencies for each package.
	 *
	 * This method is necessary to implement cross-repository jump-to-def when it is not possible to
	 * resolve the global location of the definition from data present or derived from the local
	 * workspace. For example, a package manager might not include information about the source
	 * repository of each dependency. In this case, definition resolution requires mapping from
	 * package descriptor to repository revision URL. A reverse index can be constructed from calls
	 * to workspace/xpackages to provide an efficient mapping.
	 */
	workspaceXpackages(params = {}, span = new Span()): Observable<PackageInformation[]> {
		// Ensure package.json files
		return Observable.from(this.projectManager.ensureModuleStructure(span))
			// Iterate all files
			.mergeMap<void, string>(() => this.inMemoryFileSystem.uris() as any)
			// Filter own package.jsons
			.filter(uri => uri.includes('/package.json') && !uri.includes('/node_modules/'))
			// Map to contents of package.jsons
			.mergeMap(uri =>
				Observable.from(this.updater.ensure(uri))
					.map(() => JSON.parse(this.inMemoryFileSystem.getContent(uri))
			))
			// Map each package.json to a PackageInformation
			.mergeMap(packageJson => {
				const packageDescriptor: PackageDescriptor = {
					name: packageJson.name,
					version: packageJson.version,
					repoURL: packageJson.repository && packageJson.repository.url || undefined
				};
				// Collect all dependencies for this package.json
				return Observable.of('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')
					.filter(key => packageJson[key])
					// Get [name, version] pairs
					.mergeMap(key => toPairs(packageJson[key]) as [string, string][])
					// Map to DependencyReferences
					.map(([name, version]): DependencyReference => ({
						attributes: {
							name,
							version
						},
						hints: {
							dependeePackageName: packageJson.name
						}
					}))
					.toArray()
					// Map to PackageInformation
					.map(dependencies => ({
						package: packageDescriptor,
						dependencies
					}));
			})
			.toArray();
	}

	/**
	 * Returns all dependencies of a workspace.
	 * Superseded by workspace/xpackages
	 */
	workspaceXdependencies(params = {}, span = new Span()): Observable<DependencyReference[]> {
		// Ensure package.json files
		return Observable.from(this.projectManager.ensureModuleStructure())
			// Iterate all files
			.mergeMap<void, string>(() => this.inMemoryFileSystem.uris() as any)
			// Filter own package.jsons
			.filter(uri => uri.includes('/package.json') && !uri.includes('/node_modules/'))
			// Ensure contents of own package.jsons
			.mergeMap(uri =>
				Observable.from(this.updater.ensure(uri))
					.map(() => JSON.parse(this.inMemoryFileSystem.getContent(uri))
			))
			// Map package.json to DependencyReferences
			.mergeMap(packageJson =>
				Observable.of('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')
					.filter(key => packageJson[key])
					// Get [name, version] pairs
					.mergeMap(key => toPairs(packageJson[key]) as [string, string][])
					.map(([name, version]): DependencyReference => ({
						attributes: {
							name,
							version
						},
						hints: {
							dependeePackageName: packageJson.name
						}
					}))
			)
			.toArray();
	}

	/**
	 * The Completion request is sent from the client to the server to compute completion items at a
	 * given cursor position. Completion items are presented in the
	 * [IntelliSense](https://code.visualstudio.com/docs/editor/editingevolved#_intellisense) user
	 * interface. If computing full completion items is expensive, servers can additionally provide
	 * a handler for the completion item resolve request ('completionItem/resolve'). This request is
	 * sent when a completion item is selected in the user interface. A typically use case is for
	 * example: the 'textDocument/completion' request doesn't fill in the `documentation` property
	 * for returned completion items since it is expensive to compute. When the item is selected in
	 * the user interface then a 'completionItem/resolve' request is sent with the selected
	 * completion item as a param. The returned completion item should have the documentation
	 * property filled in.
	 */
	async textDocumentCompletion(params: TextDocumentPositionParams, span = new Span()): Promise<CompletionList> {

		// Ensure files needed to suggest completions are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span).toPromise();

		const fileName: string = util.uri2path(params.textDocument.uri);

		const configuration = this.projectManager.getConfiguration(fileName);
		configuration.ensureBasicFiles();

		const sourceFile = this._getSourceFile(configuration, fileName);
		if (!sourceFile) {
			return CompletionList.create();
		}

		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
		const completions = configuration.getService().getCompletionsAtPosition(fileName, offset);

		if (completions == null) {
			return CompletionList.create();
		}

		return CompletionList.create(completions.entries.map(item => {
			const ret = CompletionItem.create(item.name);
			const kind = completionKinds[item.kind];
			if (kind) {
				ret.kind = kind;
			}
			if (item.sortText) {
				ret.sortText = item.sortText;
			}
			const details = configuration.getService().getCompletionEntryDetails(fileName, offset, item.name);
			if (details) {
				ret.documentation = ts.displayPartsToString(details.documentation);
				ret.detail = ts.displayPartsToString(details.displayParts);
			}
			return ret;
		}));
	}

	/**
	 * The signature help request is sent from the client to the server to request signature
	 * information at a given cursor position.
	 */
	async textDocumentSignatureHelp(params: TextDocumentPositionParams, span = new Span()): Promise<SignatureHelp> {

		// Ensure files needed to resolve signature are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span).toPromise();

		const filePath = util.uri2path(params.textDocument.uri);
		const configuration = this.projectManager.getConfiguration(filePath);
		configuration.ensureBasicFiles();

		const sourceFile = this._getSourceFile(configuration, filePath);
		if (!sourceFile) {
			throw new Error(`expected source file ${filePath} to exist in configuration`);
		}
		const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);

		const signatures: ts.SignatureHelpItems = configuration.getService().getSignatureHelpItems(filePath, offset);
		if (!signatures) {
			return { signatures: [], activeParameter: 0, activeSignature: 0 };
		}

		const signatureInformations = signatures.items.map(item => {
			const prefix = ts.displayPartsToString(item.prefixDisplayParts);
			const params = item.parameters.map(p => ts.displayPartsToString(p.displayParts)).join(', ');
			const suffix = ts.displayPartsToString(item.suffixDisplayParts);
			const parameters = item.parameters.map(p => {
				return ParameterInformation.create(ts.displayPartsToString(p.displayParts), ts.displayPartsToString(p.documentation));
			});
			return SignatureInformation.create(prefix + params + suffix, ts.displayPartsToString(item.documentation), ...parameters);
		});

		return {
			signatures: signatureInformations,
			activeSignature: signatures.selectedItemIndex,
			activeParameter: signatures.argumentIndex
		};
	}
	/*
	 * walkMostAST walks most of the AST (the part that matters for gathering all references)
	 */
	private _walkMostAST(node: ts.Node, visit: (node: ts.Node) => void) {
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
			case ts.SyntaxKind.SpreadElement: {
				const n = node as ts.SpreadElement;
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
				this._walkMostAST(child, visit);
			}
		}
	}

	/**
	 * The document open notification is sent from the client to the server to signal newly opened
	 * text documents. The document's truth is now managed by the client and the server must not try
	 * to read the document's truth using the document's uri.
	 */
	async textDocumentDidOpen(params: DidOpenTextDocumentParams): Promise<void> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);

		// Ensure files needed for most operations are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri).toPromise();

		this.projectManager.didOpen(util.uri2path(uri), params.textDocument.text);
	}

	/**
	 * The document change notification is sent from the client to the server to signal changes to a
	 * text document. In 2.0 the shape of the params has changed to include proper version numbers
	 * and language ids.
	 */
	async textDocumentDidChange(params: DidChangeTextDocumentParams): Promise<void> {
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		let text = null;
		params.contentChanges.forEach(change => {
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

	/**
	 * The document save notification is sent from the client to the server when the document was
	 * saved in the client.
	 */
	async textDocumentDidSave(params: DidSaveTextDocumentParams): Promise<void> {

		// Ensure files needed to suggest completions are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri).toPromise();

		// TODO don't use "relative" URI
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		this.projectManager.didSave(util.uri2path(uri));
	}

	/**
	 * The document close notification is sent from the client to the server when the document got
	 * closed in the client. The document's truth now exists where the document's uri points to
	 * (e.g. if the document's uri is a file uri the truth now exists on disk).
	 */
	async textDocumentDidClose(params: DidCloseTextDocumentParams): Promise<void> {

		// Ensure files needed to suggest completions are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri).toPromise();

		// TODO don't use "relative" URI
		const uri = util.uri2reluri(params.textDocument.uri, this.root);
		this.projectManager.didClose(util.uri2path(uri));
	}

	/**
	 * Fetches (or creates if needed) source file object for a given file name
	 * @param configuration project configuration
	 * @param fileName file name to fetch source file for or create it
	 */
	private _getSourceFile(configuration: pm.ProjectConfiguration, fileName: string): ts.SourceFile | null {
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
	 * transformNavItem transforms a NavigateToItem instance to a SymbolInformation instance
	 */
	private _transformNavItem(program: ts.Program, item: ts.NavigateToItem): SymbolInformation {
		const sourceFile = program.getSourceFile(item.fileName);
		if (!sourceFile) {
			throw new Error('source file "' + item.fileName + '" does not exist');
		}
		const start = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start);
		const end = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start + item.textSpan.length);
		return SymbolInformation.create(item.name,
			util.convertStringtoSymbolKind(item.kind),
			Range.create(start.line, start.character, end.line, end.character),
			this._defUri(item.fileName), item.containerName);
	}

	/**
	 * Returns an Iterator for all symbols in a given config
	 *
	 * Note: This method is not traced because it returns an Iterator that may produce values lazily
	 *
	 * @param config The ProjectConfiguration to search
	 * @param query A text or SymbolDescriptor query
	 * @param limit An optional limit that is passed to TypeScript
	 * @return Iterator that emits SymbolInformations
	 */
	private _collectWorkspaceSymbols(config: pm.ProjectConfiguration, query?: string | Partial<SymbolDescriptor>, limit = Infinity): IterableIterator<SymbolInformation> {
		config.ensureAllFiles();
		if (query) {
			let items: Iterable<ts.NavigateToItem>;
			if (typeof query === 'string') {
				// Query by text query
				items = config.getService().getNavigateToItems(query, limit, undefined, false);
			} else {
				// Query by name
				const packageName = config.getPackageName();
				const packageDescriptor = packageName && { name: packageName } || undefined;
				items = iterate(config.getService().getNavigateToItems(query.name || '', limit, undefined, false))
					// Filter to match SymbolDescriptor
					.filter(item => util.symbolDescriptorMatch(query, {
						kind: item.kind,
						name: item.name,
						containerKind: item.containerKind,
						containerName: item.containerName,
						package: packageDescriptor
					}));
			}
			return iterate(items)
				.map(item => this._transformNavItem(config.getProgram(), item))
				.filter(symbolInformation => util.isLocalUri(symbolInformation.location.uri));
		} else {
			// An empty query uses a different algorithm to iterate all files and aggregate the symbols per-file to get all symbols
			// TODO make all implementations use this? It has the advantage of being streamable and cancellable
			return iterate(this._getNavigationTreeItems(config)).take(limit);
		}
	}

	/**
	 * Transforms definition's file name to URI. If definition belongs to TypeScript library,
	 * returns git://github.com/Microsoft/TypeScript URL, otherwise returns file:// one
	 */
	private _defUri(filePath: string): string {
		if (isTypeScriptLibrary(filePath)) {
			return 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/' + path_.basename(filePath);
		}
		return util.path2uri(this.root, filePath);
	}

	/**
	 * Fetches up to limit navigation bar items from given project, flattens them
	 */
	private _getNavigationTreeItems(configuration: pm.ProjectConfiguration): IterableIterator<SymbolInformation> {
		return iterate(configuration.getProgram().getSourceFiles())
			// Exclude navigation items from TypeScript libraries
			.filter(sourceFile => !isTypeScriptLibrary(sourceFile.fileName))
			.map(sourceFile => {
				try {
					const tree = configuration.getService().getNavigationTree(sourceFile.fileName);
					return this._flattenNavigationTreeItem(tree, null, sourceFile);
				} catch (e) {
					this.logger.error('Could not get navigation tree for file', sourceFile.fileName);
					return [];
				}
			})
			.flatten<SymbolInformation>();
	}

	/**
	 * Flattens navigation tree by emitting acceptable NavigationTreeItems as SymbolInformations.
	 * Some items (source files, modules) may be excluded
	 */
	private *_flattenNavigationTreeItem(item: ts.NavigationTree, parent: ts.NavigationTree | null, sourceFile: ts.SourceFile): IterableIterator<SymbolInformation> {
		const acceptable = TypeScriptService.isAcceptableNavigationTreeItem(item);
		if (acceptable) {
			yield this._transformNavigationTreeItem(item, parent, sourceFile);
		}
		if (item.childItems) {
			for (const childItem of item.childItems) {
				yield* this._flattenNavigationTreeItem(childItem, acceptable ? item : null, sourceFile);
			}
		}
	}

	/**
	 * Transforms NavigationTree to SymbolInformation
	 */
	private _transformNavigationTreeItem(item: ts.NavigationTree, parent: ts.NavigationTree | null, sourceFile: ts.SourceFile): SymbolInformation {
		const span = item.spans[0];
		const start = ts.getLineAndCharacterOfPosition(sourceFile, span.start);
		const end = ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length);
		return {
			name: item.text,
			kind: util.convertStringtoSymbolKind(item.kind),
			location: {
				uri: this._defUri(sourceFile.fileName),
				range: { start, end }
			},
			containerName: parent ? parent.text : ''
		};
	}

	/**
	 * @return true if navigation tree item is acceptable for inclusion into workspace/symbols
	 */
	private static isAcceptableNavigationTreeItem(item: ts.NavigationTree): boolean {
		// modules and source files should be excluded
		if ([ts.ScriptElementKind.moduleElement, 'sourcefile'].indexOf(item.kind) >= 0) {
			return false;
		}
		// special items may start with ", (, [, or <
		if (/^[<\(\[\"]/.test(item.text)) {
			return false;
		}
		// magic words
		if (['default', 'constructor', 'new()'].indexOf(item.text) >= 0) {
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

/**
 * Maps string-based CompletionEntry::kind to enum-based CompletionItemKind
 */
const completionKinds: { [name: string]: CompletionItemKind } = {
	class: CompletionItemKind.Class,
	constructor: CompletionItemKind.Constructor,
	enum: CompletionItemKind.Enum,
	field: CompletionItemKind.Field,
	file: CompletionItemKind.File,
	function: CompletionItemKind.Function,
	interface: CompletionItemKind.Interface,
	keyword: CompletionItemKind.Keyword,
	method: CompletionItemKind.Method,
	module: CompletionItemKind.Module,
	property: CompletionItemKind.Property,
	reference: CompletionItemKind.Reference,
	snippet: CompletionItemKind.Snippet,
	text: CompletionItemKind.Text,
	unit: CompletionItemKind.Unit,
	value: CompletionItemKind.Value,
	variable: CompletionItemKind.Variable
};
