import * as fs from 'fs';
import * as os from 'os';
import * as path_ from 'path';
import * as ts from 'typescript';
import { IConnection, Position, Location, SymbolInformation, Range, Hover } from 'vscode-languageserver';

import * as async from 'async';

import * as FileSystem from './fs';
import * as util from './util';
import * as pm from './project-manager';

var sanitizeHtml = require('sanitize-html');
var JSONPath = require('jsonpath-plus');

export default class TypeScriptService {

	projectManager: pm.ProjectManager;
	root: string;

	private connection: IConnection;

	private emptyQueryWorkspaceSymbols: Promise<SymbolInformation[]>; // cached response for empty workspace/symbol query

	private strict: boolean;

	constructor(root: string, strict: boolean, connection: IConnection) {
		this.root = root;
		this.projectManager = new pm.ProjectManager(root, strict, connection);
		this.connection = connection;
		this.strict = strict;

		// kick off prefetching for workspace/symbol, but don't block
		this.ensureFilesForWorkspaceSymbol();
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
					return this.projectManager.getConfiguration(fileName).prepare(this.connection).then((config) => {
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
			if (util.isJSTSFile(path)) {
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

	getDefinition(uri: string, line: number, column: number): Promise<Location[]> {
		return this.ensureFilesForHoverAndDefinition(uri).then(() => new Promise<Location[]>((resolve, reject) => {
			const fileName: string = util.uri2path(uri);
			try {
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.prepare(this.connection).then((configuration) => {
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
								const sourceFile = configuration.program.getSourceFile(def.fileName);
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

	getHover(uri: string, line: number, column: number): Promise<Hover> {
		return this.ensureFilesForHoverAndDefinition(uri).then(() => new Promise<Hover>((resolve, reject) => {
			const fileName: string = util.uri2path(uri);
			try {
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.prepare(this.connection).then(() => {
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

	getReferences(uri: string, line: number, column: number): Promise<Location[]> {
		return this.ensureFilesForReferences(uri).then(() => new Promise<Location[]>((resolve, reject) => {
			const fileName: string = util.uri2path(uri);
			try {
				const configuration = this.projectManager.getConfiguration(fileName);
				configuration.prepare(this.connection).then(() => {
					try {
						const sourceFile = this.getSourceFile(configuration, fileName);
						if (!sourceFile) {
							return resolve([]);
						}

						const started = new Date().getTime();

						this.projectManager.syncConfigurationFor(fileName, this.connection);

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

	getWorkspaceSymbols(query: string, limit?: number): Promise<SymbolInformation[]> {
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

	getPositionFromOffset(fileName: string, offset: number): Position {
		// TODO: initialize configuration object by calling .get()
		const configuration = this.projectManager.getConfiguration(fileName);
		const sourceFile = this.getSourceFile(configuration, fileName);
		if (!sourceFile) {
			return null;
		}
		let res = ts.getLineAndCharacterOfPosition(sourceFile, offset);
		return Position.create(res.line, res.character);
	}

	didOpen(uri: string, text: string) {
		return this.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didOpen(util.uri2path(uri), text, this.connection);
		});
	}

	didChange(uri: string, text: string) {
		return this.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didChange(util.uri2path(uri), text, this.connection);
		});
	}

	didClose(uri: string) {
		return this.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didClose(util.uri2path(uri), this.connection);
		});
	}

	didSave(uri: string) {
		return this.ensureFilesForHoverAndDefinition(uri).then(() => {
			this.projectManager.didSave(util.uri2path(uri));
		});
	}

    /**
     * Fetches (or creates if needed) source file object for a given file name
     * @param configuration project configuration
     * @param fileName file name to fetch source file for or create it
     */
	private getSourceFile(configuration: pm.ProjectConfiguration, fileName: string): ts.SourceFile {
		if (!this.projectManager.hasFile(fileName)) {
			return null;
		}
		const sourceFile = configuration.program.getSourceFile(fileName);
		if (sourceFile) {
			return sourceFile;
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
				util.path2uri('', item.fileName), item.containerName));
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

		configuration.prepare(this.connection).then(() => {
			setImmediate(() => {
				this.projectManager.syncConfiguration(configuration, this.connection);
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
			return 'git://github.com/Microsoft/TypeScript?v2.0.6#lib/' + path_.basename(filePath);
		}
		return util.path2uri(this.root, filePath);
	}

    /**
     * Fetches up to limit navigation bar items from given project, flattennes them  
     */
	private getNavigationTreeItems(configuration: pm.ProjectConfiguration, limit?: number): SymbolInformation[] {
		const result = [];
		const libraries = pm.getTypeScriptLibraries();
		for (const sourceFile of configuration.program.getSourceFiles()) {
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
			util.path2uri('', sourceFile.fileName), parent ? parent.text : '');
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
