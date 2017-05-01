import { Observable } from '@reactivex/rxjs';
import iterate from 'iterare';
import { toPairs } from 'lodash';
import { Span } from 'opentracing';
import * as path_ from 'path';
import * as ts from 'typescript';
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
	Location,
	MarkedString,
	ParameterInformation,
	ReferenceParams,
	SignatureHelp,
	SignatureInformation,
	SymbolInformation,
	TextDocumentPositionParams,
	TextDocumentSyncKind
} from 'vscode-languageserver';
import { walkMostAST } from './ast';
import { DiagnosticsPublisher } from './diagnostics';
import { FileSystem, FileSystemUpdater, LocalFileSystem, RemoteFileSystem } from './fs';
import { LanguageClient } from './lang-handler';
import { Logger, LSPLogger } from './logging';
import { InMemoryFileSystem, isTypeScriptLibrary } from './memfs';
import * as pm from './project-manager';
import {
	DependencyReference,
	InitializeParams,
	InitializeResult,
	PackageDescriptor,
	PackageInformation,
	ReferenceInformation,
	SymbolDescriptor,
	SymbolLocationInformation,
	WorkspaceReferenceParams,
	WorkspaceSymbolParams
} from './request-type';
import * as util from './util';
import hashObject = require('object-hash');

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
	private emptyQueryWorkspaceSymbols: Observable<SymbolInformation[]>;

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

	/**
	 * Emits true or false depending on whether the root package.json is named "definitely-typed".
	 * On DefinitelyTyped, files are not prefetched and a special workspace/symbol algorithm is used.
	 */
	protected isDefinitelyTyped: Observable<boolean>;

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
	initialize(params: InitializeParams, span = new Span()): Observable<InitializeResult> {
		if (params.rootUri || params.rootPath) {
			this.root = params.rootPath || util.uri2path(params.rootUri!);
			this.rootUri = params.rootUri || util.path2uri('', params.rootPath!);
			this._initializeFileSystems(!this.options.strict && !(params.capabilities.xcontentProvider && params.capabilities.xfilesProvider));
			this.updater = new FileSystemUpdater(this.fileSystem, this.inMemoryFileSystem);
			const diagnosticsPublisher = new DiagnosticsPublisher(this.client);
			this.projectManager = new pm.ProjectManager(this.root, this.inMemoryFileSystem, this.updater, diagnosticsPublisher, !!this.options.strict, this.traceModuleResolution, this.logger);

			// Detect DefinitelyTyped
			// Fetch root package.json (if exists)
			const normRootUri = this.rootUri.endsWith('/') ? this.rootUri : this.rootUri + '/';
			const packageJsonUri = normRootUri + 'package.json';
			this.isDefinitelyTyped = Observable.from(this.updater.ensure(packageJsonUri))
				.map(() => {
					// Check name
					const packageJson = JSON.parse(this.inMemoryFileSystem.getContent(packageJsonUri));
					return packageJson.name === 'definitely-typed';
				})
				.catch(err => [false])
				.publishReplay()
				.refCount();

			// Pre-fetch files in the background if not DefinitelyTyped
			this.isDefinitelyTyped
				.mergeMap(isDefinitelyTyped => {
					if (!isDefinitelyTyped) {
						return this.projectManager.ensureOwnFiles(span);
					}
					return [];
				})
				.subscribe(undefined, err => {
					this.logger.error(err);
				});
		}
		return Observable.of({
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
		});
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
	shutdown(params = {}, span = new Span()): Observable<null> {
		this.projectManager.dispose();
		return Observable.of(null);
	}

	/**
	 * The goto definition request is sent from the client to the server to resolve the definition
	 * location of a symbol at a given text document position.
	 */
	textDocumentDefinition(params: TextDocumentPositionParams, span = new Span()): Observable<Location[]> {

		// Fetch files needed to resolve definition
		return this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span)
			.toArray()
			.mergeMap(() => {
				const fileName: string = util.uri2path(params.textDocument.uri);
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.ensureBasicFiles(span);

				const sourceFile = this._getSourceFile(configuration, fileName, span);
				if (!sourceFile) {
					throw new Error(`Expected source file ${fileName} to exist`);
				}

				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
				const definitions: ts.DefinitionInfo[] | undefined = configuration.getService().getDefinitionAtPosition(fileName, offset);

				return Observable.from(definitions || [])
					.map((definition): Location => {
						const sourceFile = this._getSourceFile(configuration, definition.fileName, span);
						if (!sourceFile) {
							throw new Error('expected source file "' + definition.fileName + '" to exist in configuration');
						}
						const start = ts.getLineAndCharacterOfPosition(sourceFile, definition.textSpan.start);
						const end = ts.getLineAndCharacterOfPosition(sourceFile, definition.textSpan.start + definition.textSpan.length);
						return {
							uri: this._defUri(definition.fileName),
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
	 * This method is the same as textDocument/definition, except that:
	 *
	 * - The method returns metadata about the definition (the same metadata that
	 * workspace/xreferences searches for).
	 * - The concrete location to the definition (location field)
	 * is optional. This is useful because the language server might not be able to resolve a goto
	 * definition request to a concrete location (e.g. due to lack of dependencies) but still may
	 * know some information about it.
	 */
	textDocumentXdefinition(params: TextDocumentPositionParams, span = new Span()): Observable<SymbolLocationInformation[]> {
		// Ensure files needed to resolve SymbolLocationInformation are fetched
		return this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span)
			.toArray()
			.mergeMap(() => {
				// Convert URI to file path
				const fileName: string = util.uri2path(params.textDocument.uri);
				// Get closest tsconfig configuration
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.ensureBasicFiles(span);
				const sourceFile = this._getSourceFile(configuration, fileName, span);
				if (!sourceFile) {
					throw new Error(`Unknown text document ${params.textDocument.uri}`);
				}
				// Convert line/character to offset
				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
				// Query TypeScript for references
				return Observable.from(configuration.getService().getDefinitionAtPosition(fileName, offset) || [])
					// Map DefinitionInfo to SymbolLocationInformation
					.map(def => {
						const sourceFile = this._getSourceFile(configuration, def.fileName, span);
						if (!sourceFile) {
							throw new Error(`Expected source file ${def.fileName} to exist in configuration`);
						}
						// Convert offset to line/character
						const start = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
						const end = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start + def.textSpan.length);
						return {
							symbol: util.defInfoToSymbolDescriptor(def),
							location: {
								uri: this._defUri(def.fileName),
								range: {
									start,
									end
								}
							}
						};
					});
			})
			.toArray();

	}

	/**
	 * The hover request is sent from the client to the server to request hover information at a
	 * given text document position.
	 */
	textDocumentHover(params: TextDocumentPositionParams, span = new Span()): Observable<Hover> {

		// Ensure files needed to resolve hover are fetched
		return this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span)
			.toArray()
			.map((): Hover => {
				const fileName: string = util.uri2path(params.textDocument.uri);
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.ensureBasicFiles(span);

				const sourceFile = this._getSourceFile(configuration, fileName, span);
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

				return {
					contents,
					range: {
						start,
						end
					}
				};
			});
	}

	/**
	 * The references request is sent from the client to the server to resolve project-wide
	 * references for the symbol denoted by the given text document position.
	 *
	 * Returns all references to the symbol at the position in the own workspace, including references inside node_modules.
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
				configuration.ensureAllFiles(span);
				const program = configuration.getProgram();
				if (!program) {
					return [];
				}
				// Get SourceFile object for requested file
				const sourceFile = this._getSourceFile(configuration, fileName, span);
				if (!sourceFile) {
					throw new Error(`Source file ${fileName} does not exist`);
				}
				// Convert line/character to offset
				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
				// Request references at position from TypeScript
				// Despite the signature, getReferencesAtPosition() can return undefined
				return Observable.from(configuration.getService().getReferencesAtPosition(fileName, offset) || [])
					.filter(reference =>
						// Filter declaration if not requested
						(!reference.isDefinition || (params.context && params.context.includeDeclaration))
						// Filter references in node_modules
						&& !reference.fileName.includes('/node_modules/')
					)
					// Map to Locations
					.map(reference => {
						const sourceFile = program.getSourceFile(reference.fileName);
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
	workspaceSymbol(params: WorkspaceSymbolParams, span = new Span()): Observable<SymbolInformation[]> {

		// Always return max. 50 results
		// TODO stream 50 results, then re-query and stream the rest
		const limit = Math.min(params.limit || Infinity, 50);

		const query = params.query;
		const symbolQuery = params.symbol && { ...params.symbol };

		if (symbolQuery && symbolQuery.package) {
			// Strip all fields except name from PackageDescriptor
			symbolQuery.package = { name: symbolQuery.package.name };
		}

		// Return cached result for empty query, if available
		if (!query && !symbolQuery && this.emptyQueryWorkspaceSymbols) {
			return this.emptyQueryWorkspaceSymbols;
		}

		// Use special logic for DefinitelyTyped
		return this.isDefinitelyTyped
			.mergeMap((isDefinitelyTyped): any => {
				if (isDefinitelyTyped) {
					return this._workspaceSymbolDefinitelyTyped({ ...params, limit }, span);
				}

				// symbolQuery.containerKind is sometimes empty when symbol.containerKind = 'module'
				if (symbolQuery && !symbolQuery.containerKind) {
					symbolQuery.containerKind = undefined;
				}

				// A workspace/symol request searches all symbols in own code, but not in dependencies
				const symbols = Observable.from(this.projectManager.ensureOwnFiles(span))
					.mergeMap<void, pm.ProjectConfiguration>(() => this.projectManager.configurations() as any)
					// If PackageDescriptor is given, only search project with the matching package name
					.filter(config => !symbolQuery || !symbolQuery.package || !symbolQuery.package.name || config.getPackageName() === symbolQuery.package!.name)
					.mergeMap<pm.ProjectConfiguration, SymbolInformation>(config => this._collectWorkspaceSymbols(config, query || symbolQuery, limit) as any)
					.filter(symbol => !symbol.location.uri.includes('/node_modules/'))
					// Filter duplicate symbols
					// There may be few configurations that contain the same file(s)
					// or files from different configurations may refer to the same file(s)
					.distinct(symbol => hashObject(symbol, { respectType: false } as any))
					.take(limit)
					.toArray()
					.publishReplay()
					.refCount();

				if (!query && !symbolQuery) {
					this.emptyQueryWorkspaceSymbols = symbols;
				}

				return symbols;
			});
	}

	/**
	 * Specialised version of workspaceSymbol for DefinitelyTyped.
	 * Searches only in the correct subdirectory for the given PackageDescriptor.
	 * Will error if not passed a SymbolDescriptor query with an `@types` PackageDescriptor
	 */
	protected _workspaceSymbolDefinitelyTyped(params: WorkspaceSymbolParams, childOf = new Span()): Observable<SymbolInformation[]> {
		const span = childOf.tracer().startSpan('Handle workspace/symbol DefinitelyTyped', { childOf });

		if (!params.symbol || !params.symbol.package || !params.symbol.package.name || !params.symbol.package.name.startsWith('@types/')) {
			return Observable.throw('workspace/symbol on DefinitelyTyped is only supported with a SymbolDescriptor query with an @types PackageDescriptor');
		}

		const symbolQuery = { ...params.symbol };
		// Don't match PackageDescriptor on symbols
		symbolQuery.package = undefined;
		// symQuery.containerKind is sometimes empty when symbol.containerKind = 'module'
		if (!symbolQuery.containerKind) {
			symbolQuery.containerKind = undefined;
		}

		// Fetch all files in the package subdirectory
		// All packages are in the types/ subdirectory
		const normRootUri = this.rootUri.endsWith('/') ? this.rootUri : this.rootUri + '/';
		const packageRootUri = normRootUri + params.symbol.package.name.substr(1) + '/';

		return Observable.from(this.updater.ensureStructure(span))
			.mergeMap(() => Observable.from<string>(this.inMemoryFileSystem.uris() as any))
			.filter(uri => uri.startsWith(packageRootUri))
			.mergeMap(uri => this.updater.ensure(uri, span))
			.toArray()
			.mergeMap<any, SymbolInformation>(() => {
				this.projectManager.createConfigurations();
				span.log({ event: 'fetched package files' });

				// Search symbol in configuration
				// forcing TypeScript mode
				const config = this.projectManager.getConfiguration(util.uri2path(packageRootUri), 'ts');
				return this._collectWorkspaceSymbols(config, params.query || symbolQuery, params.limit) as any;
			})
			.toArray()
			.catch(err => {
				span.setTag('error', true);
				span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
				throw err;
			})
			.finally(() => {
				span.finish();
			});
	}

	/**
	 * The document symbol request is sent from the client to the server to list all symbols found
	 * in a given text document.
	 */
	textDocumentDocumentSymbol(params: DocumentSymbolParams, span = new Span()): Observable<SymbolInformation[]> {

		// Ensure files needed to resolve symbols are fetched
		return this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span)
			.toArray()
			.mergeMap<any, SymbolInformation>(() => {
				const fileName = util.uri2path(params.textDocument.uri);

				const config = this.projectManager.getConfiguration(fileName);
				config.ensureBasicFiles(span);
				const sourceFile = this._getSourceFile(config, fileName, span);
				if (!sourceFile) {
					return [];
				}
				const tree = config.getService().getNavigationTree(fileName);
				return this._flattenNavigationTreeItem(tree, null, sourceFile) as any;
			})
			.toArray();
	}

	/**
	 * The workspace references request is sent from the client to the server to locate project-wide
	 * references to a symbol given its description / metadata.
	 */
	workspaceXreferences(params: WorkspaceReferenceParams, span = new Span()): Observable<ReferenceInformation[]> {
		return Observable.from(this.projectManager.ensureAllFiles(span))
			.mergeMap<void, pm.ProjectConfiguration>(() => this.projectManager.configurations() as any)
			// If we were hinted that we should only search a specific package, trust it
			.filter(config => !(params.hints && params.hints.dependeePackageName && params.hints.dependeePackageName !== config.getPackageName()))
			.mergeMap(config => {
				config.ensureAllFiles(span);
				return Observable.from(config.getService().getProgram().getSourceFiles())
					// Ignore dependency files
					.filter(source => !util.toUnixPath(source.fileName).includes('/node_modules/'))
					.mergeMap(source =>
						// Iterate AST of source file
						Observable.from<ts.Node>(walkMostAST(source) as any)
							// Filter Identifier Nodes
							// TODO: include string-interpolated references
							.filter((node): node is ts.Identifier => node.kind === ts.SyntaxKind.Identifier)
							.mergeMap(node => {
								try {
									// Get DefinitionInformations at the node
									return Observable.from(config.getService().getDefinitionAtPosition(source.fileName, node.pos + 1) || [])
										// Map to SymbolDescriptor
										.map(definition => util.defInfoToSymbolDescriptor(definition))
										// Check if SymbolDescriptor matches
										.filter(symbol => util.isSymbolDescriptorMatch(params.query, symbol))
										// Map SymbolDescriptor to ReferenceInformation
										.map(symbol => ({
											symbol,
											reference: {
												uri: this._defUri(source.fileName),
												range: {
													start: ts.getLineAndCharacterOfPosition(source, node.pos + 1),
													end: ts.getLineAndCharacterOfPosition(source, node.end)
												}
											}
										}));
								} catch (err) {
									// Continue with next node on error
									// Workaround for https://github.com/Microsoft/TypeScript/issues/15219
									this.logger.error(`workspace/xreferences: Error getting definition for ${source.fileName} at offset ${node.pos + 1}`, err);
									span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
									return [];
								}
							})
					);
			})
			.toArray();
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
	textDocumentCompletion(params: TextDocumentPositionParams, span = new Span()): Observable<CompletionList> {

		// Ensure files needed to suggest completions are fetched
		return this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span)
			.toArray()
			.map((): CompletionList => {

				const fileName: string = util.uri2path(params.textDocument.uri);

				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.ensureBasicFiles(span);

				const sourceFile = this._getSourceFile(configuration, fileName, span);
				if (!sourceFile) {
					return { isIncomplete: true, items: [] };
				}

				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
				const completions = configuration.getService().getCompletionsAtPosition(fileName, offset);

				if (completions == null) {
					return { isIncomplete: true, items: [] };
				}

				return {
					isIncomplete: false,
					items: completions.entries.map(entry => {
						const item: CompletionItem = { label: entry.name };
						const kind = completionKinds[entry.kind];
						if (kind) {
							item.kind = kind;
						}
						if (entry.sortText) {
							item.sortText = entry.sortText;
						}
						const details = configuration.getService().getCompletionEntryDetails(fileName, offset, entry.name);
						if (details) {
							item.documentation = ts.displayPartsToString(details.documentation);
							item.detail = ts.displayPartsToString(details.displayParts);
						}
						return item;
					})
				};
			});
	}

	/**
	 * The signature help request is sent from the client to the server to request signature
	 * information at a given cursor position.
	 */
	textDocumentSignatureHelp(params: TextDocumentPositionParams, span = new Span()): Observable<SignatureHelp> {

		// Ensure files needed to resolve signature are fetched
		return this.projectManager.ensureReferencedFiles(params.textDocument.uri, undefined, undefined, span)
			.toArray()
			.map((): SignatureHelp => {

				const filePath = util.uri2path(params.textDocument.uri);
				const configuration = this.projectManager.getConfiguration(filePath);
				configuration.ensureBasicFiles(span);

				const sourceFile = this._getSourceFile(configuration, filePath, span);
				if (!sourceFile) {
					throw new Error(`expected source file ${filePath} to exist in configuration`);
				}
				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);

				const signatures: ts.SignatureHelpItems = configuration.getService().getSignatureHelpItems(filePath, offset);
				if (!signatures) {
					return { signatures: [], activeParameter: 0, activeSignature: 0 };
				}

				const signatureInformations = signatures.items.map((item): SignatureInformation => {
					const prefix = ts.displayPartsToString(item.prefixDisplayParts);
					const params = item.parameters.map(p => ts.displayPartsToString(p.displayParts)).join(', ');
					const suffix = ts.displayPartsToString(item.suffixDisplayParts);
					const parameters = item.parameters.map((p): ParameterInformation => ({
						label: ts.displayPartsToString(p.displayParts),
						documentation: ts.displayPartsToString(p.documentation)
					}));
					return {
						label: prefix + params + suffix,
						documentation: ts.displayPartsToString(item.documentation),
						parameters
					};
				});

				return {
					signatures: signatureInformations,
					activeSignature: signatures.selectedItemIndex,
					activeParameter: signatures.argumentIndex
				};
			});
	}

	/**
	 * The document open notification is sent from the client to the server to signal newly opened
	 * text documents. The document's truth is now managed by the client and the server must not try
	 * to read the document's truth using the document's uri.
	 */
	async textDocumentDidOpen(params: DidOpenTextDocumentParams): Promise<void> {

		// Ensure files needed for most operations are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri).toPromise();

		this.projectManager.didOpen(params.textDocument.uri, params.textDocument.text);
	}

	/**
	 * The document change notification is sent from the client to the server to signal changes to a
	 * text document. In 2.0 the shape of the params has changed to include proper version numbers
	 * and language ids.
	 */
	async textDocumentDidChange(params: DidChangeTextDocumentParams): Promise<void> {
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
		this.projectManager.didChange(params.textDocument.uri, text);
	}

	/**
	 * The document save notification is sent from the client to the server when the document was
	 * saved in the client.
	 */
	async textDocumentDidSave(params: DidSaveTextDocumentParams): Promise<void> {

		// Ensure files needed to suggest completions are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri).toPromise();
		this.projectManager.didSave(params.textDocument.uri);
	}

	/**
	 * The document close notification is sent from the client to the server when the document got
	 * closed in the client. The document's truth now exists where the document's uri points to
	 * (e.g. if the document's uri is a file uri the truth now exists on disk).
	 */
	async textDocumentDidClose(params: DidCloseTextDocumentParams): Promise<void> {

		// Ensure files needed to suggest completions are fetched
		await this.projectManager.ensureReferencedFiles(params.textDocument.uri).toPromise();

		this.projectManager.didClose(params.textDocument.uri);
	}

	/**
	 * Fetches (or creates if needed) source file object for a given file name
	 *
	 * @param configuration project configuration
	 * @param fileName file name to fetch source file for or create it
	 * @param span Span for tracing
	 */
	private _getSourceFile(configuration: pm.ProjectConfiguration, fileName: string, span = new Span()): ts.SourceFile | undefined {
		let program = configuration.getProgram();
		if (!program) {
			return undefined;
		}
		const sourceFile = program.getSourceFile(fileName);
		if (sourceFile) {
			return sourceFile;
		}
		if (!this.projectManager.hasFile(fileName)) {
			return undefined;
		}
		configuration.getHost().addFile(fileName);
		// Update program object
		configuration.syncProgram(span);
		program = configuration.getProgram();
		return program && program.getSourceFile(fileName);
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
	private _collectWorkspaceSymbols(config: pm.ProjectConfiguration, query?: string | Partial<SymbolDescriptor>, limit = Infinity, span = new Span()): IterableIterator<SymbolInformation> {
		config.ensureAllFiles(span);
		const program = config.getProgram();
		if (!program) {
			return iterate([]);
		}

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
					.filter(item => util.isSymbolDescriptorMatch(query, {
						kind: item.kind,
						name: item.name,
						containerKind: item.containerKind,
						containerName: item.containerName,
						package: packageDescriptor
					}));
			}
			return iterate(items)
				// Map NavigateToItems to SymbolInformations
				.map(item => {
					const sourceFile = program.getSourceFile(item.fileName);
					if (!sourceFile) {
						throw new Error(`Source file ${item.fileName} does not exist`);
					}
					const symbolInformation: SymbolInformation = {
						name: item.name,
						kind: util.convertStringtoSymbolKind(item.kind),
						location: {
							uri: this._defUri(item.fileName),
							range: {
								start: ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start),
								end: ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start + item.textSpan.length)
							}
						}
					};
					if (item.containerName) {
						symbolInformation.containerName = item.containerName;
					}
					return symbolInformation;
				})
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
		const program = configuration.getProgram();
		if (!program) {
			return iterate([]);
		}
		return iterate(program.getSourceFiles())
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
			const span = item.spans[0];
			const symbolInformation: SymbolInformation = {
				name: item.text,
				kind: util.convertStringtoSymbolKind(item.kind),
				location: {
					uri: this._defUri(sourceFile.fileName),
					range: {
						start: ts.getLineAndCharacterOfPosition(sourceFile, span.start),
						end: ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length)
					}
				}
			};
			if (parent) {
				symbolInformation.containerName = parent.text;
			}
			yield symbolInformation;
		}
		if (item.childItems) {
			for (const childItem of item.childItems) {
				yield* this._flattenNavigationTreeItem(childItem, acceptable ? item : null, sourceFile);
			}
		}
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
