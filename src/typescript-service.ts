import { Observable } from '@reactivex/rxjs';
import iterate from 'iterare';
import { AddPatch, OpPatch } from 'json-patch';
import { toPairs } from 'lodash';
import { Span } from 'opentracing';
import * as path from 'path';
import * as ts from 'typescript';
import {
	CodeActionParams,
	Command,
	CompletionItem,
	CompletionItemKind,
	CompletionList,
	DidChangeConfigurationParams,
	DidChangeTextDocumentParams,
	DidCloseTextDocumentParams,
	DidOpenTextDocumentParams,
	DidSaveTextDocumentParams,
	DocumentSymbolParams,
	ExecuteCommandParams,
	Hover,
	Location,
	MarkedString,
	ParameterInformation,
	ReferenceParams,
	RenameParams,
	SignatureHelp,
	SignatureInformation,
	SymbolInformation,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	TextEdit,
	WorkspaceEdit
} from 'vscode-languageserver';
import { walkMostAST } from './ast';
import { convertTsDiagnostic } from './diagnostics';
import { FileSystem, FileSystemUpdater, LocalFileSystem, RemoteFileSystem } from './fs';
import { LanguageClient } from './lang-handler';
import { Logger, LSPLogger } from './logging';
import { InMemoryFileSystem, isTypeScriptLibrary } from './memfs';
import { ProjectConfiguration, ProjectManager } from './project-manager';
import {
	DependencyReference,
	InitializeParams,
	InitializeResult,
	PackageDescriptor,
	PackageInformation,
	SymbolDescriptor,
	SymbolLocationInformation,
	WorkspaceReferenceParams,
	WorkspaceSymbolParams
} from './request-type';
import {
	convertStringtoSymbolKind,
	defInfoToSymbolDescriptor,
	getMatchScore,
	isLocalUri,
	isSymbolDescriptorMatch,
	JSONPTR,
	normalizeUri,
	path2uri,
	toUnixPath,
	uri2path
} from './util';
import hashObject = require('object-hash');
import { castArray, merge, noop, omit } from 'lodash';
import * as url from 'url';
import { extractDefinitelyTypedPackageName, extractNodeModulesPackageName, PackageJson, PackageManager } from './packages';

export interface TypeScriptServiceOptions {
	traceModuleResolution?: boolean;
	strict?: boolean;
}

export type TypeScriptServiceFactory = (client: LanguageClient, options?: TypeScriptServiceOptions) => TypeScriptService;

/**
 * Settings synced through `didChangeConfiguration`
 */
export interface Settings {
	format: ts.FormatCodeSettings;
}

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

	projectManager: ProjectManager;

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
	private emptyQueryWorkspaceSymbols: Observable<OpPatch>;

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

	/**
	 * Keeps track of package.jsons in the workspace
	 */
	protected packageManager: PackageManager;

	/**
	 * Settings synced though `didChangeConfiguration`
	 */
	protected settings: Settings = {
		format: {
			tabSize: 4,
			indentSize: 4,
			newLineCharacter: '\n',
			convertTabsToSpaces: false,
			insertSpaceAfterCommaDelimiter: true,
			insertSpaceAfterSemicolonInForStatements: true,
			insertSpaceBeforeAndAfterBinaryOperators: true,
			insertSpaceAfterKeywordsInControlFlowStatements: true,
			insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
			insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
			insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
			insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
			insertSpaceBeforeFunctionParenthesis: false,
			placeOpenBraceOnNewLineForFunctions: false,
			placeOpenBraceOnNewLineForControlBlocks: false
		}
	};

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
	 *
	 * @return Observable of JSON Patches that build an `InitializeResult`
	 */
	initialize(params: InitializeParams, span = new Span()): Observable<OpPatch> {
		if (params.rootUri || params.rootPath) {
			this.root = params.rootPath || uri2path(params.rootUri!);
			this.rootUri = params.rootUri || path2uri('', params.rootPath!);
			// The root URI always refers to a directory
			if (!this.rootUri.endsWith('/')) {
				this.rootUri += '/';
			}
			this._initializeFileSystems(!this.options.strict && !(params.capabilities.xcontentProvider && params.capabilities.xfilesProvider));
			this.updater = new FileSystemUpdater(this.fileSystem, this.inMemoryFileSystem);
			this.projectManager = new ProjectManager(
				this.root,
				this.inMemoryFileSystem,
				this.updater,
				!!this.options.strict,
				this.traceModuleResolution,
				this.logger
			);
			this.packageManager = new PackageManager(this.updater, this.inMemoryFileSystem, this.logger);
			// Detect DefinitelyTyped
			// Fetch root package.json (if exists)
			const normRootUri = this.rootUri.endsWith('/') ? this.rootUri : this.rootUri + '/';
			const packageJsonUri = normRootUri + 'package.json';
			this.isDefinitelyTyped = Observable.from(this.packageManager.getPackageJson(packageJsonUri, span))
				// Check name
				.map(packageJson => packageJson.name === 'definitely-typed')
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
		const result: InitializeResult = {
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
				codeActionProvider: true,
				renameProvider: true,
				executeCommandProvider: {
					commands: []
				},
				xpackagesProvider: true
			}
		};
		return Observable.of({
			op: 'add',
			path: '',
			value: result
		} as OpPatch);
	}

	/**
	 * Initializes the remote file system and in-memory file system.
	 * Can be overridden
	 *
	 * @param accessDisk Whether the language server is allowed to access the local file system
	 */
	protected _initializeFileSystems(accessDisk: boolean): void {
		this.fileSystem = accessDisk ? new LocalFileSystem(this.rootUri) : new RemoteFileSystem(this.client);
		this.inMemoryFileSystem = new InMemoryFileSystem(this.root);
	}

	/**
	 * The shutdown request is sent from the client to the server. It asks the server to shut down,
	 * but to not exit (otherwise the response might not be delivered correctly to the client).
	 * There is a separate exit notification that asks the server to exit.
	 *
	 * @return Observable of JSON Patches that build a `null` result
	 */
	shutdown(params = {}, span = new Span()): Observable<OpPatch> {
		this.projectManager.dispose();
		this.packageManager.dispose();
		return Observable.of({ op: 'add', path: '', value: null } as AddPatch);
	}

	/**
	 * A notification sent from the client to the server to signal the change of configuration
	 * settings.
	 */
	didChangeConfiguration(params: DidChangeConfigurationParams): void {
		merge(this.settings, params.settings);
	}

	/**
	 * The goto definition request is sent from the client to the server to resolve the definition
	 * location of a symbol at a given text document position.
	 *
	 * @return Observable of JSON Patches that build a `Location[]` result
	 */

	textDocumentDefinition(params: TextDocumentPositionParams, span = new Span()): Observable<OpPatch> {
		return this._getDefinitionLocations(params, span)
			.map((location: Location): OpPatch => ({ op: 'add', path: '/-', value: location }))
			.startWith({ op: 'add', path: '', value: [] });
	}

	/**
	 * Returns an Observable of all definition locations found for a symbol.
	 */
	protected _getDefinitionLocations(params: TextDocumentPositionParams, span = new Span()): Observable<Location> {
		const uri = normalizeUri(params.textDocument.uri);

		// Fetch files needed to resolve definition
		return this.projectManager.ensureReferencedFiles(uri, undefined, undefined, span)
			.toArray()
			.mergeMap(() => {
				const fileName: string = uri2path(uri);
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
			});
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
	 *
	 * @return Observable of JSON Patches that build a `SymbolLocationInformation[]` result
	 */

	textDocumentXdefinition(params: TextDocumentPositionParams, span = new Span()): Observable<OpPatch> {
		return this._getSymbolLocationInformations(params, span)
			.map(symbol => ({ op: 'add', path: '/-', value: symbol } as AddPatch))
			.startWith({ op: 'add', path: '', value: [] });
	}

	/**
	 * Returns an Observable of SymbolLocationInformations for the definition of a symbol at the given position
	 */
	protected _getSymbolLocationInformations(params: TextDocumentPositionParams, span = new Span()): Observable<SymbolLocationInformation> {
		const uri = normalizeUri(params.textDocument.uri);
		// Ensure files needed to resolve SymbolLocationInformation are fetched
		return this.projectManager.ensureReferencedFiles(uri, undefined, undefined, span)
			.toArray()
			.mergeMap(() => {
				// Convert URI to file path
				const fileName: string = uri2path(uri);
				// Get closest tsconfig configuration
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.ensureBasicFiles(span);
				const sourceFile = this._getSourceFile(configuration, fileName, span);
				if (!sourceFile) {
					throw new Error(`Unknown text document ${uri}`);
				}
				// Convert line/character to offset
				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
				// Query TypeScript for references
				return Observable.from(configuration.getService().getDefinitionAtPosition(fileName, offset) || [])
					.mergeMap((definition: ts.DefinitionInfo): Observable<SymbolLocationInformation> => {
						const definitionUri = this._defUri(definition.fileName);
						// Get the PackageDescriptor
						return this._getPackageDescriptor(definitionUri)
							.map((packageDescriptor: PackageDescriptor | undefined): SymbolLocationInformation => {
								const sourceFile = this._getSourceFile(configuration, definition.fileName, span);
								if (!sourceFile) {
									throw new Error(`Expected source file ${definition.fileName} to exist in configuration`);
								}
								const symbol = defInfoToSymbolDescriptor(definition);
								if (packageDescriptor) {
									symbol.package = packageDescriptor;
								}
								return {
									symbol,
									location: {
										uri: definitionUri,
										range: {
											start: ts.getLineAndCharacterOfPosition(sourceFile, definition.textSpan.start),
											end: ts.getLineAndCharacterOfPosition(sourceFile, definition.textSpan.start + definition.textSpan.length)
										}
									}
								};
							});
					});
			});
	}

	/**
	 * Finds the PackageDescriptor a given file belongs to
	 *
	 * @return Observable that emits a single PackageDescriptor or undefined if the definition does not belong to any package
	 */
	protected _getPackageDescriptor(uri: string): Observable<PackageDescriptor | undefined> {
		// Get package name of the dependency in which the symbol is defined in, if any
		const packageName = extractNodeModulesPackageName(uri);
		if (packageName) {
			// The symbol is part of a dependency in node_modules
			// Build URI to package.json of the Dependency
			const encodedPackageName = packageName.split('/').map(encodeURIComponent).join('/');
			const parts = url.parse(uri);
			const packageJsonUri = url.format({ ...parts, pathname: parts.pathname!.slice(0, parts.pathname!.lastIndexOf('/node_modules/' + encodedPackageName)) + `/node_modules/${encodedPackageName}/package.json` });
			// Fetch the package.json of the dependency
			return Observable.from(this.updater.ensure(packageJsonUri))
				.map((): PackageDescriptor | undefined => {
					const packageJson = JSON.parse(this.inMemoryFileSystem.getContent(packageJsonUri));
					const { name, version } = packageJson;
					if (name) {
						// Used by the LSP proxy to shortcut database lookup of repo URL for PackageDescriptor
						let repoURL: string | undefined;
						if (name.startsWith('@types/')) {
							// if the dependency package is an @types/ package, point the repo to DefinitelyTyped
							repoURL = 'https://github.com/DefinitelyTyped/DefinitelyTyped';
						} else {
							// else use repository field from package.json
							repoURL = typeof packageJson.repository === 'object' ? packageJson.repository.url : undefined;
						}
						return { name, version, repoURL };
					}
					return undefined;
				});
		} else {
			// The symbol is defined in the root package of the workspace, not in a dependency
			// Get root package.json
			return Observable.from(this.packageManager.getClosestPackageJson(uri))
				.map((packageJson): PackageDescriptor | undefined => {
					if (!packageJson) {
						// Workspace has no package.json
						return undefined;
					}
					let { name, version } = packageJson;
					if (name) {
						let repoURL = typeof packageJson.repository === 'object' ? packageJson.repository.url : undefined;
						// If the root package is DefinitelyTyped, find out the proper @types package name for each typing
						if (name === 'definitely-typed') {
							name = extractDefinitelyTypedPackageName(uri);
							if (!name) {
								this.logger.error(`Could not extract package name from DefinitelyTyped URI ${uri}`);
								return undefined;
							}
							version = undefined;
							repoURL = 'https://github.com/DefinitelyTyped/DefinitelyTyped';
						}
						return { name, version, repoURL };
					}
					return undefined;
				});
		}
	}

	/**
	 * The hover request is sent from the client to the server to request hover information at a
	 * given text document position.
	 *
	 * @return Observable of JSON Patches that build a `Hover` result
	 */
	textDocumentHover(params: TextDocumentPositionParams, span = new Span()): Observable<OpPatch> {
		return this._getHover(params, span)
			.map(hover => ({ op: 'add', path: '', value: hover }) as AddPatch);
	}

	/**
	 * Returns an Observable for a Hover at the given position
	 */
	protected _getHover(params: TextDocumentPositionParams, span = new Span()): Observable<Hover> {
		const uri = normalizeUri(params.textDocument.uri);

		// Ensure files needed to resolve hover are fetched
		return this.projectManager.ensureReferencedFiles(uri, undefined, undefined, span)
			.toArray()
			.map((): Hover => {
				const fileName: string = uri2path(uri);
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.ensureBasicFiles(span);

				const sourceFile = this._getSourceFile(configuration, fileName, span);
				if (!sourceFile) {
					throw new Error(`Unknown text document ${uri}`);
				}
				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
				const info = configuration.getService().getQuickInfoAtPosition(fileName, offset);
				if (!info) {
					return { contents: [] };
				}
				const contents: (MarkedString | string)[] = [];
				// Add declaration without the kind
				const declaration = ts.displayPartsToString(info.displayParts).replace(/^\(.+\)\s+/, '');
				contents.push({ language: 'typescript', value: declaration });
				// Add kind with modifiers, e.g. "method (private, ststic)", "class (exported)"
				if (info.kind) {
					let kind = '**' + info.kind + '**';
					const modifiers = info.kindModifiers
						.split(',')
						// Filter out some quirks like "constructor (exported)"
						.filter(mod => mod && (
							mod !== ts.ScriptElementKindModifier.exportedModifier
							|| info.kind !== ts.ScriptElementKind.constructorImplementationElement
						))
						// Make proper adjectives
						.map(mod => ({
							[ts.ScriptElementKindModifier.ambientModifier]: 'ambient',
							[ts.ScriptElementKindModifier.exportedModifier]: 'exported'
						})[mod] || mod);
					if (modifiers.length > 0) {
						kind += ' _(' + modifiers.join(', ') + ')_';
					}
					contents.push(kind);
				}
				// Add documentation
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
	 *
	 * @return Observable of JSON Patches that build a `Location[]` result
	 */
	textDocumentReferences(params: ReferenceParams, span = new Span()): Observable<OpPatch> {
		const uri = normalizeUri(params.textDocument.uri);

		// Ensure all files were fetched to collect all references
		return Observable.from(this.projectManager.ensureOwnFiles(span))
			.mergeMap(() => {
				// Convert URI to file path because TypeScript doesn't work with URIs
				const fileName = uri2path(uri);
				// Get tsconfig configuration for requested file
				const configuration = this.projectManager.getConfiguration(fileName);
				// Ensure all files have been added
				configuration.ensureAllFiles(span);
				const program = configuration.getProgram(span);
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
					.map((reference): Location => {
						const sourceFile = program.getSourceFile(reference.fileName);
						if (!sourceFile) {
							throw new Error(`Source file ${reference.fileName} does not exist`);
						}
						// Convert offset to line/character position
						const start = ts.getLineAndCharacterOfPosition(sourceFile, reference.textSpan.start);
						const end = ts.getLineAndCharacterOfPosition(sourceFile, reference.textSpan.start + reference.textSpan.length);
						return {
							uri: path2uri(this.root, reference.fileName),
							range: {
								start,
								end
							}
						};
					});
			})
			.map((location: Location): AddPatch => ({ op: 'add', path: '/-', value: location }))
			// Initialize with array
			.startWith({ op: 'add', path: '', value: [] });
	}

	/**
	 * The workspace symbol request is sent from the client to the server to list project-wide
	 * symbols matching the query string. The text document parameter specifies the active document
	 * at time of the query. This can be used to rank or limit results.
	 *
	 * @return Observable of JSON Patches that build a `SymbolInformation[]` result
	 */
	workspaceSymbol(params: WorkspaceSymbolParams, span = new Span()): Observable<OpPatch> {

		// Always return max. 50 results
		// TODO stream 50 results, then re-query and stream the rest
		const limit = Math.min(params.limit || Infinity, 50);

		// Return cached result for empty query, if available
		if (!params.query && !params.symbol && this.emptyQueryWorkspaceSymbols) {
			return this.emptyQueryWorkspaceSymbols;
		}

		/** A sorted array that keeps track of symbol match scores to determine the index to insert the symbol at */
		const scores: number[] = [];

		let observable = this.isDefinitelyTyped
			.mergeMap((isDefinitelyTyped: boolean): Observable<[number, SymbolInformation]> => {
				// Use special logic for DefinitelyTyped
				// Search only in the correct subdirectory for the given PackageDescriptor
				if (isDefinitelyTyped) {
					// Error if not passed a SymbolDescriptor query with an `@types` PackageDescriptor
					if (!params.symbol || !params.symbol.package || !params.symbol.package.name || !params.symbol.package.name.startsWith('@types/')) {
						return Observable.throw('workspace/symbol on DefinitelyTyped is only supported with a SymbolDescriptor query with an @types PackageDescriptor');
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
						.mergeMap(() => {
							span.log({ event: 'fetched package files' });
							const config = this.projectManager.getParentConfiguration(packageRootUri, 'ts');
							if (!config) {
								throw new Error(`Could not find tsconfig for ${packageRootUri}`);
							}
							// Don't match PackageDescriptor on symbols
							return this._getSymbolsInConfig(config, params.query || omit(params.symbol!, 'package'), limit, span);
						});
				}
				// Regular workspace symbol search
				// Search all symbols in own code, but not in dependencies
				return Observable.from(this.projectManager.ensureOwnFiles(span))
					.mergeMap<void, ProjectConfiguration>(() =>
						params.symbol && params.symbol.package && params.symbol.package.name
							// If SymbolDescriptor query with PackageDescriptor, search for package.jsons with matching package name
							? Observable.from<string>(this.packageManager.packageJsonUris() as any)
								.filter(packageJsonUri => (JSON.parse(this.inMemoryFileSystem.getContent(packageJsonUri)) as PackageJson).name === params.symbol!.package!.name)
								// Find their parent and child tsconfigs
								.mergeMap(packageJsonUri => Observable.merge(
									castArray<ProjectConfiguration>(this.projectManager.getParentConfiguration(packageJsonUri) || []),
									// Search child directories starting at the directory of the package.json
									this.projectManager.getChildConfigurations(url.resolve(packageJsonUri, '.')) as any
								))
							// Else search all tsconfigs in the workspace
							: this.projectManager.configurations() as any
					)
					// If PackageDescriptor is given, only search project with the matching package name
					.mergeMap(config => this._getSymbolsInConfig(config, params.query || params.symbol, limit, span));
			})
			// Filter symbols found in dependencies
			.filter(([score, symbol]) => !symbol.location.uri.includes('/node_modules/'))
			// Filter duplicate symbols
			// There may be few configurations that contain the same file(s)
			// or files from different configurations may refer to the same file(s)
			.distinct(symbol => hashObject(symbol, { respectType: false } as any))
			.take(limit)
			// Find out at which index to insert the symbol to maintain sorting order by score
			.map(([score, symbol]) => {
				const index = scores.findIndex(s => s < score);
				if (index === -1) {
					scores.push(score);
					return { op: 'add', path: '/-', value: symbol } as AddPatch;
				}
				scores.splice(index, 0, score);
				return { op: 'add', path: '/' + index, value: symbol } as AddPatch;
			})
			.startWith({ op: 'add', path: '', value: [] });

		if (!params.query && !params.symbol) {
			observable = this.emptyQueryWorkspaceSymbols = observable.publishReplay().refCount();
		}

		return observable;
	}

	/**
	 * The document symbol request is sent from the client to the server to list all symbols found
	 * in a given text document.
	 *
	 * @return Observable of JSON Patches that build a `SymbolInformation[]` result
	 */
	textDocumentDocumentSymbol(params: DocumentSymbolParams, span = new Span()): Observable<OpPatch> {
		const uri = normalizeUri(params.textDocument.uri);

		// Ensure files needed to resolve symbols are fetched
		return this.projectManager.ensureReferencedFiles(uri, undefined, undefined, span)
			.toArray()
			.mergeMap<any, SymbolInformation>(() => {
				const fileName = uri2path(uri);

				const config = this.projectManager.getConfiguration(fileName);
				config.ensureBasicFiles(span);
				const sourceFile = this._getSourceFile(config, fileName, span);
				if (!sourceFile) {
					return [];
				}
				const tree = config.getService().getNavigationTree(fileName);
				return this._flattenNavigationTreeItem(tree, null, sourceFile) as any;
			})
			.map(symbol => ({ op: 'add', path: '', value: symbol }) as AddPatch)
			.startWith({ op: 'add', path: '', value: [] } as AddPatch);
	}

	/**
	 * The workspace references request is sent from the client to the server to locate project-wide
	 * references to a symbol given its description / metadata.
	 *
	 * @return Observable of JSON Patches that build a `ReferenceInformation[]` result
	 */
	workspaceXreferences(params: WorkspaceReferenceParams, span = new Span()): Observable<OpPatch> {
		const queryWithoutPackage = omit(params.query, 'package');
		return Observable.from(this.projectManager.ensureAllFiles(span))
			.mergeMap<void, ProjectConfiguration>(() => {
				// if we were hinted that we should only search a specific package, find it and only search the owning tsconfig.json
				if (params.hints && params.hints.dependeePackageName) {
					return Observable.from<string>(this.packageManager.packageJsonUris() as any)
						.filter(uri => (JSON.parse(this.inMemoryFileSystem.getContent(uri)) as PackageJson).name === params.hints!.dependeePackageName)
						.take(1)
						.mergeMap<string, ProjectConfiguration>(uri => {
							const config = this.projectManager.getParentConfiguration(uri);
							if (!config) {
								return this.projectManager.configurations() as any;
							}
							return [config];
						});
				}
				// else search all tsconfig.jsons
				return this.projectManager.configurations() as any;
			})
			.mergeMap((config: ProjectConfiguration) => {
				config.ensureAllFiles(span);
				const program = config.getProgram(span);
				if (!program) {
					return Observable.empty();
				}
				return Observable.from(program.getSourceFiles())
					// Ignore dependency files
					.filter(source => !toUnixPath(source.fileName).includes('/node_modules/'))
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
										.mergeMap(definition => {
											const symbol = defInfoToSymbolDescriptor(definition);
											// Check if SymbolDescriptor without PackageDescriptor matches
											if (!isSymbolDescriptorMatch(queryWithoutPackage, symbol)) {
												return [];
											}
											// If no PackageDescriptor query, return match
											if (!params.query.package || !params.query.package) {
												return [symbol];
											}
											// If SymbolDescriptor matched and the query contains a PackageDescriptor, get package.json and match PackageDescriptor name
											// TODO match full PackageDescriptor (version)
											const uri = path2uri('', definition.fileName);
											return this._getPackageDescriptor(uri)
												.mergeMap(packageDescriptor => {
													symbol.package = packageDescriptor;
													return packageDescriptor && packageDescriptor.name === params.query.package!.name!
														? [symbol]
														: [];
												});
										})
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
			.map((reference): AddPatch => ({ op: 'add', path: '/-', value: reference }))
			.startWith({ op: 'add', path: '', value: [] });
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
	 *
	 * @return Observable of JSON Patches that build a `PackageInformation[]` result
	 */
	workspaceXpackages(params = {}, span = new Span()): Observable<OpPatch> {
		// Ensure package.json files
		return Observable.from(this.projectManager.ensureModuleStructure(span))
			// Iterate all files
			.mergeMap<void, string>(() => this.inMemoryFileSystem.uris() as any)
			// Filter own package.jsons
			.filter(uri => uri.includes('/package.json') && !uri.includes('/node_modules/'))
			// Map to contents of package.jsons
			.mergeMap(uri => this.packageManager.getPackageJson(uri))
			// Map each package.json to a PackageInformation
			.mergeMap(packageJson => {
				if (!packageJson.name) {
					return [];
				}
				const packageDescriptor: PackageDescriptor = {
					name: packageJson.name,
					version: packageJson.version,
					repoURL: typeof packageJson.repository === 'object' && packageJson.repository.url || undefined
				};
				// Collect all dependencies for this package.json
				return Observable.of<keyof  PackageJson>('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')
					.filter(key => !!packageJson[key])
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
					.map((dependencies): PackageInformation => ({
						package: packageDescriptor,
						dependencies
					}));
			})
			.map((packageInfo): AddPatch => ({ op: 'add', path: '/-', value: packageInfo }))
			.startWith({ op: 'add', path: '', value: [] });
	}

	/**
	 * Returns all dependencies of a workspace.
	 * Superseded by workspace/xpackages
	 *
	 * @return Observable of JSON Patches that build a `DependencyReference[]` result
	 */
	workspaceXdependencies(params = {}, span = new Span()): Observable<OpPatch> {
		// Ensure package.json files
		return Observable.from(this.projectManager.ensureModuleStructure())
			// Iterate all files
			.mergeMap<void, string>(() => this.inMemoryFileSystem.uris() as any)
			// Filter own package.jsons
			.filter(uri => uri.includes('/package.json') && !uri.includes('/node_modules/'))
			// Ensure contents of own package.jsons
			.mergeMap(uri => this.packageManager.getPackageJson(uri))
			// Map package.json to DependencyReferences
			.mergeMap(packageJson =>
				Observable.of<keyof PackageJson>('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')
					.filter(key => !!packageJson[key])
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
			.map((dependency): AddPatch => ({ op: 'add', path: '/-', value: dependency }))
			.startWith({ op: 'add', path: '', value: [] });
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
	 *
	 * @return Observable of JSON Patches that build a `CompletionList` result
	 */
	textDocumentCompletion(params: TextDocumentPositionParams, span = new Span()): Observable<OpPatch> {
		const uri = normalizeUri(params.textDocument.uri);

		// Ensure files needed to suggest completions are fetched
		return this.projectManager.ensureReferencedFiles(uri, undefined, undefined, span)
			.toArray()
			.mergeMap(() => {

				const fileName: string = uri2path(uri);

				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.ensureBasicFiles(span);

				const sourceFile = this._getSourceFile(configuration, fileName, span);
				if (!sourceFile) {
					return [];
				}

				const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);
				const completions = configuration.getService().getCompletionsAtPosition(fileName, offset);

				if (completions == null) {
					return [];
				}

				return Observable.from(completions.entries)
					.map(entry =>  {
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
						return { op: 'add', path: '/items/-', value: item } as AddPatch;
					})
					.startWith({ op: 'add', path: '/isIncomplete', value: false } as AddPatch);
			})
			.startWith({ op: 'add', path: '', value: { isIncomplete: true, items: [] } as CompletionList } as AddPatch);
	}

	/**
	 * The signature help request is sent from the client to the server to request signature
	 * information at a given cursor position.
	 *
	 * @return Observable of JSON Patches that build a `SignatureHelp` result
	 */
	textDocumentSignatureHelp(params: TextDocumentPositionParams, span = new Span()): Observable<OpPatch> {
		const uri = normalizeUri(params.textDocument.uri);

		// Ensure files needed to resolve signature are fetched
		return this.projectManager.ensureReferencedFiles(uri, undefined, undefined, span)
			.toArray()
			.map((): SignatureHelp => {

				const filePath = uri2path(uri);
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
			})
			.map(signatureHelp => ({ op: 'add', path: '', value: signatureHelp }) as AddPatch);
	}

	/**
	 * The code action request is sent from the client to the server to compute commands for a given
	 * text document and range. These commands are typically code fixes to either fix problems or to
	 * beautify/refactor code.
	 *
	 * @return Observable of JSON Patches that build a `Command[]` result
	 */
	textDocumentCodeAction(params: CodeActionParams, span = new Span()): Observable<OpPatch> {
		const uri = normalizeUri(params.textDocument.uri);
		return this.projectManager.ensureReferencedFiles(uri, undefined, undefined, span)
			.toArray()
			.mergeMap(() => {
				const configuration = this.projectManager.getParentConfiguration(uri);
				if (!configuration) {
					throw new Error(`Could not find tsconfig for ${uri}`);
				}
				configuration.ensureBasicFiles(span);

				const filePath = uri2path(uri);
				const sourceFile = this._getSourceFile(configuration, filePath, span);
				if (!sourceFile) {
					throw new Error(`Expected source file ${filePath} to exist in configuration`);
				}

				const start = ts.getPositionOfLineAndCharacter(sourceFile, params.range.start.line, params.range.start.character);
				const end = ts.getPositionOfLineAndCharacter(sourceFile, params.range.end.line, params.range.end.character);

				const errorCodes = iterate(params.context.diagnostics)
					.map(diagnostic => diagnostic.code)
					.filter(code => typeof code === 'number')
					.toArray() as number[];

				return configuration.getService().getCodeFixesAtPosition(filePath, start, end, errorCodes, this.settings.format || {}) || [];
			})
			.map((action: ts.CodeAction): AddPatch => ({
				op: 'add',
				path: '/-',
				value: {
					title: action.description,
					command: 'codeFix',
					arguments: action.changes
				} as Command
			}))
			.startWith({ op: 'add', path: '', value: [] } as AddPatch);
	}

	/**
	 * The workspace/executeCommand request is sent from the client to the server to trigger command
	 * execution on the server. In most cases the server creates a WorkspaceEdit structure and
	 * applies the changes to the workspace using the request workspace/applyEdit which is sent from
	 * the server to the client.
	 */
	workspaceExecuteCommand(params: ExecuteCommandParams, span = new Span()): Observable<OpPatch> {
		switch (params.command) {
			case 'codeFix':
				if (!params.arguments || params.arguments.length < 1) {
					return Observable.throw(new Error(`Command ${params.command} requires arguments`));
				}
				return this.executeCodeFixCommand(params.arguments, span);
			default:
				return Observable.throw(new Error(`Unknown command ${params.command}`));
		}
	}

	/**
	 * Executes the `codeFix` command
	 *
	 * @return Observable of JSON Patches for `null` result
	 */
	executeCodeFixCommand(fileTextChanges: ts.FileTextChanges[], span = new Span()): Observable<OpPatch> {
		if (fileTextChanges.length === 0) {
			return Observable.throw(new Error('No changes supplied for code fix command'));
		}

		return Observable.from(this.projectManager.ensureOwnFiles(span))
			.mergeMap(() => {
				const configuration = this.projectManager.getConfiguration(fileTextChanges[0].fileName);
				configuration.ensureBasicFiles(span);

				const changes: {[uri: string]: TextEdit[]} = {};
				for (const change of fileTextChanges) {
					const sourceFile = this._getSourceFile(configuration, change.fileName, span);
					if (!sourceFile) {
						throw new Error(`Expected source file ${change.fileName} to exist in configuration`);
					}
					const uri = path2uri(this.root, change.fileName);
					changes[uri] = change.textChanges.map(({ span, newText }): TextEdit => ({
						range: {
							start: ts.getLineAndCharacterOfPosition(sourceFile, span.start),
							end: ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length)
						},
						newText
					}));
				}

				return this.client.workspaceApplyEdit({ edit: { changes }}, span);
			})
			.map(() => ({ op: 'add', path: '', value: null }) as AddPatch);
	}

	/**
	 * The rename request is sent from the client to the server to perform a workspace-wide rename of a symbol.
	 *
	 * @return Observable of JSON Patches that build a `WorkspaceEdit` result
	 */
	textDocumentRename(params: RenameParams, span = new Span()): Observable<OpPatch> {
		const uri = normalizeUri(params.textDocument.uri);
		const editUris = new Set<string>();
		return Observable.fromPromise(this.projectManager.ensureOwnFiles(span))
			.mergeMap(() => {

				const filePath = uri2path(uri);
				const configuration = this.projectManager.getParentConfiguration(params.textDocument.uri);
				if (!configuration) {
					throw new Error(`tsconfig.json not found for ${filePath}`);
				}
				configuration.ensureAllFiles(span);

				const sourceFile = this._getSourceFile(configuration, filePath, span);
				if (!sourceFile) {
					throw new Error(`Expected source file ${filePath} to exist in configuration`);
				}

				const position = ts.getPositionOfLineAndCharacter(sourceFile, params.position.line, params.position.character);

				const renameInfo = configuration.getService().getRenameInfo(filePath, position);
				if (!renameInfo.canRename) {
					throw new Error('This symbol cannot be renamed');
				}

				return Observable.from(configuration.getService().findRenameLocations(filePath, position, false, true))
					.map((location: ts.RenameLocation): [string, TextEdit] => {
						const sourceFile = this._getSourceFile(configuration, location.fileName, span);
						if (!sourceFile) {
							throw new Error(`expected source file ${location.fileName} to exist in configuration`);
						}
						const editUri = path2uri(this.root, location.fileName);
						const start = ts.getLineAndCharacterOfPosition(sourceFile, location.textSpan.start);
						const end = ts.getLineAndCharacterOfPosition(sourceFile, location.textSpan.start + location.textSpan.length);
						const edit: TextEdit = { range: { start, end }, newText: params.newName };
						return [editUri, edit];
					});
			})
			.map(([uri, edit]): AddPatch => {
				// if file has no edit yet, initialize array
				if (!editUris.has(uri)) {
					editUris.add(uri);
					return { op: 'add', path: JSONPTR`/changes/${uri}`, value: [edit] };
				}
				// else append to array
				return { op: 'add', path: JSONPTR`/changes/${uri}/-`, value: edit };
			})
			.startWith({ op: 'add', path: '', value: { changes: {} } as WorkspaceEdit } as AddPatch);
	}

	/**
	 * The document open notification is sent from the client to the server to signal newly opened
	 * text documents. The document's truth is now managed by the client and the server must not try
	 * to read the document's truth using the document's uri.
	 */
	async textDocumentDidOpen(params: DidOpenTextDocumentParams): Promise<void> {
		const uri = normalizeUri(params.textDocument.uri);
		// Ensure files needed for most operations are fetched
		await this.projectManager.ensureReferencedFiles(uri).toPromise();
		this.projectManager.didOpen(uri, params.textDocument.text);
		this._publishDiagnostics(uri);
	}

	/**
	 * The document change notification is sent from the client to the server to signal changes to a
	 * text document. In 2.0 the shape of the params has changed to include proper version numbers
	 * and language ids.
	 */
	async textDocumentDidChange(params: DidChangeTextDocumentParams): Promise<void> {
		const uri = normalizeUri(params.textDocument.uri);
		let text: string | undefined;
		for (const change of params.contentChanges) {
			if (change.range || change.rangeLength) {
				throw new Error('incremental updates in textDocument/didChange not supported for file ' + uri);
			}
			text = change.text;
		}
		if (!text) {
			return;
		}
		this.projectManager.didChange(uri, text);
		this._publishDiagnostics(uri);
	}

	/**
	 * Generates and publishes diagnostics for a given file
	 *
	 * @param uri URI of the file to check
	 */
	private _publishDiagnostics(uri: string, span = new Span()): void {
		const config = this.projectManager.getParentConfiguration(uri);
		if (!config) {
			return;
		}
		const program = config.getProgram(span);
		if (!program) {
			return;
		}
		const sourceFile = program.getSourceFile(uri2path(uri));
		if (!sourceFile) {
			return;
		}
		const tsDiagnostics = ts.getPreEmitDiagnostics(program, sourceFile);
		const diagnostics = iterate(tsDiagnostics)
			// TS can report diagnostics without a file and range in some cases
			// These cannot be represented as LSP Diagnostics since the range and URI is required
			// https://github.com/Microsoft/TypeScript/issues/15666
			.filter(diagnostic => !!diagnostic.file)
			.map(convertTsDiagnostic)
			.toArray();
		this.client.textDocumentPublishDiagnostics({ uri, diagnostics });
	}

	/**
	 * The document save notification is sent from the client to the server when the document was
	 * saved in the client.
	 */
	async textDocumentDidSave(params: DidSaveTextDocumentParams): Promise<void> {
		const uri = normalizeUri(params.textDocument.uri);

		// Ensure files needed to suggest completions are fetched
		await this.projectManager.ensureReferencedFiles(uri).toPromise();
		this.projectManager.didSave(uri);
	}

	/**
	 * The document close notification is sent from the client to the server when the document got
	 * closed in the client. The document's truth now exists where the document's uri points to
	 * (e.g. if the document's uri is a file uri the truth now exists on disk).
	 */
	async textDocumentDidClose(params: DidCloseTextDocumentParams): Promise<void> {
		const uri = normalizeUri(params.textDocument.uri);

		// Ensure files needed to suggest completions are fetched
		await this.projectManager.ensureReferencedFiles(uri).toPromise();

		this.projectManager.didClose(uri);

		// Clear diagnostics
		this.client.textDocumentPublishDiagnostics({ uri, diagnostics: [] });
	}

	/**
	 * Fetches (or creates if needed) source file object for a given file name
	 *
	 * @param configuration project configuration
	 * @param fileName file name to fetch source file for or create it
	 * @param span Span for tracing
	 */
	private _getSourceFile(configuration: ProjectConfiguration, fileName: string, span = new Span()): ts.SourceFile | undefined {
		let program = configuration.getProgram(span);
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
		program = configuration.getProgram(span);
		return program && program.getSourceFile(fileName);
	}

	/**
	 * Returns an Iterator for all symbols in a given config that match a given SymbolDescriptor
	 *
	 * @param config The ProjectConfiguration to search
	 * @param query A text or SymbolDescriptor query
	 * @param limit An optional limit that is passed to TypeScript
	 * @return Observable of SymbolInformations
	 */
	protected _getSymbolsInConfig(config: ProjectConfiguration, query?: string | Partial<SymbolDescriptor>, limit = Infinity, childOf = new Span()): Observable<[number, SymbolInformation]> {
		const span = childOf.tracer().startSpan('Get symbols in config', { childOf });
		span.addTags({ config: config.configFilePath, query, limit });

		return (() => {
			try {
				config.ensureAllFiles(span);

				const program = config.getProgram(span);
				if (!program) {
					return Observable.empty();
				}

				if (query) {
					let items: Observable<[number, ts.NavigateToItem]>;
					if (typeof query === 'string') {
						// Query by text query
						items = Observable.from(config.getService().getNavigateToItems(query, limit, undefined, false))
							// Same score for all
							.map(item => [1, item]);
					} else {
						const queryWithoutPackage = omit(query, 'package') as SymbolDescriptor;
						// Query by name
						items = Observable.from(config.getService().getNavigateToItems(query.name || '', limit, undefined, false))
							// Get a score how good the symbol matches the SymbolDescriptor (ignoring PackageDescriptor)
							.map((item): [number, ts.NavigateToItem] => [getMatchScore(queryWithoutPackage, {
								kind: item.kind,
								name: item.name,
								containerKind: item.containerKind,
								containerName: item.containerName
							}), item])
							// If score === 0, no properties matched
							.filter(([score, symbol]) => score > 0)
							// If SymbolDescriptor matched, get package.json and match PackageDescriptor name
							// TODO get and match full PackageDescriptor (version)
							.mergeMap(([score, item]) => {
								if (!query.package || !query.package.name) {
									return [[score, item]];
								}
								const uri = path2uri('', item.fileName);
								return Observable.from(this.packageManager.getClosestPackageJson(uri, span))
									// If PackageDescriptor matches, increase score
									.map((packageJson): [number, ts.NavigateToItem] => packageJson && packageJson.name === query.package!.name! ? [score + 1, item] : [score, item]);
							});
					}
					return Observable.from(items)
						// Map NavigateToItems to SymbolInformations
						.map(([score, item]) => {
							const sourceFile = program.getSourceFile(item.fileName);
							if (!sourceFile) {
								throw new Error(`Source file ${item.fileName} does not exist`);
							}
							const symbolInformation: SymbolInformation = {
								name: item.name,
								kind: convertStringtoSymbolKind(item.kind),
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
							return [score, symbolInformation] as [number, SymbolInformation];
						})
						.filter(([score, symbolInformation]) => isLocalUri(symbolInformation.location.uri));
				} else {
					// An empty query uses a different algorithm to iterate all files and aggregate the symbols per-file to get all symbols
					// TODO make all implementations use this? It has the advantage of being streamable and cancellable
					return Observable.from<SymbolInformation>(this._getNavigationTreeItems(config) as any)
						// Same score for all
						.map(symbol => [1, symbol])
						.take(limit);
				}
			} catch (err) {
				return Observable.throw(err);
			}
		})()
			.do(noop, err => {
				span.setTag('error', true);
				span.log({ 'event': 'error', 'error.object': err, 'stack': err.stack, 'message': err.message });
			})
			.finally(() => {
				span.finish();
			});
	}

	/**
	 * Transforms definition's file name to URI. If definition belongs to TypeScript library,
	 * returns git://github.com/Microsoft/TypeScript URL, otherwise returns file:// one
	 */
	private _defUri(filePath: string): string {
		if (isTypeScriptLibrary(filePath)) {
			return 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/' + path.basename(filePath);
		}
		return path2uri(this.root, filePath);
	}

	/**
	 * Fetches up to limit navigation bar items from given project, flattens them
	 */
	private _getNavigationTreeItems(configuration: ProjectConfiguration, span = new Span()): IterableIterator<SymbolInformation> {
		const program = configuration.getProgram(span);
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
				kind: convertStringtoSymbolKind(item.kind),
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
