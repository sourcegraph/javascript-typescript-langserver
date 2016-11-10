import * as fs from 'fs';
import * as path_ from 'path';
import * as ts from 'typescript';
import { IConnection, Position, Location, SymbolInformation, Range } from 'vscode-languageserver';

import * as async from 'async';

import * as FileSystem from './fs';
import * as util from './util';
import * as pm from './project-manager';

import ExportedSymbolsProvider from './exported-symbols-provider'
import ExternalRefsProvider from './external-refs-provider';

var sanitizeHtml = require('sanitize-html');
var JSONPath = require('jsonpath-plus');

export default class TypeScriptService {

    projectManager: pm.ProjectManager;
    root: string;

    private externalRefs = null;
    private exportedEnts = null;
    private exportedSymbolProvider: ExportedSymbolsProvider;
    private externalRefsProvider: ExternalRefsProvider;

    private envDefs = [];

    private workspaceSymbols: SymbolInformation[];

    constructor(root: string, strict: boolean, connection: IConnection) {
        this.root = root;
        this.projectManager = new pm.ProjectManager(root, strict, connection);

        // initialize providers
        this.exportedSymbolProvider = new ExportedSymbolsProvider(this);
        this.externalRefsProvider = new ExternalRefsProvider(this);
    }

    getExternalRefs() {
        if (this.externalRefs === null) {
            this.externalRefs = this.externalRefsProvider.collectExternals();
        }
        return this.externalRefs;
    }

    getExportedEnts() {
        if (this.exportedEnts === null) {
            this.exportedEnts = this.exportedSymbolProvider.collectExportedEntities();
        }
        return this.exportedEnts;
    }

    doc(node: ts.Node): string {
        let text = node.getSourceFile().getFullText();
        let comments1 = (ts as any).getLeadingCommentRanges(text, node.getFullStart());
        let comments2 = (ts as any).getTrailingCommentRanges(text, node.getEnd());
        let comments = [];
        if (!comments1 && !comments2) {
            let parents = util.collectAllParents(node, []);
            for (let i = 0; i < parents.length; i++) {
                let parent = parents[i];
                let comments1 = (ts as any).getLeadingCommentRanges(text, parent.getFullStart());
                let comments2 = (ts as any).getTrailingCommentRanges(text, parent.getEnd());
                if (comments1) {
                    comments = comments.concat(comments1);
                }
                if (comments2) {
                    comments = comments.concat(comments2);
                }
                if (comments1 || comments2) break;
            }
        } else {
            comments = comments1 || comments2;
        }

        let res = "";
        if (comments) {
            comments.forEach(comment => {
                res = res + sanitizeHtml(`<p>${text.substring(comment.pos + 2, comment.end)}</p>`);
            });
        }
        return res;
    }

    private ensuredFilesForHoverAndDefinition = new Map<string, Promise<void>>();

    private ensureFilesForHoverAndDefinition(uri: string): Promise<void> {
        if (this.ensuredFilesForHoverAndDefinition.get(uri)) {
            return this.ensuredFilesForHoverAndDefinition.get(uri);
        }

        const promise = this.projectManager.ensureModuleStructure().then(() => {
            return this.ensureFilesForHoverAndDefinition_([util.uri2path(uri)], 4, new Set<string>());
        });
        this.ensuredFilesForHoverAndDefinition.set(uri, promise);
        promise.catch((err) => {
            console.error("Failed to fetch files for hover/definition for uri ", uri, ", error:", err);
            this.ensuredFilesForHoverAndDefinition.delete(uri);
        });
        return promise;
    }

    private ensureFilesForHoverAndDefinition_(fileNames: string[], level: number, seen: Set<string>): Promise<void> {
        fileNames = fileNames.filter((f) => !seen.has(f));
        if (fileNames.length === 0) {
            return Promise.resolve();
        }
        fileNames.forEach((f) => seen.add(f));

        const absFileNames = fileNames.map((f) => path_.join(path_.sep, f));
        let promise = this.projectManager.ensureFiles(absFileNames).then(() => {
            return this.projectManager.refreshConfigurations();
        });

        if (level > 0) {
            promise = promise.then(() => {
                const importFiles = new Set<string>();
                return Promise.all(fileNames.map((fileName) => {
                    return this.projectManager.getConfiguration(fileName).get().then((config) => {
                        const contents = config.moduleResolutionHost().readFile(fileName);
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
                    });
                })).then(() => {
                    return this.ensureFilesForHoverAndDefinition_(Array.from(importFiles), level - 1, seen);
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
                if (info.name.indexOf(`${path_.sep}node_modules${path_.sep}`) !== -1) {
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
        if (fileName.indexOf(`${path_.sep}node_modules${path_.sep}`) !== -1) {
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
                configuration.get().then((configuration) => {
                    try {
                        this.projectManager.syncConfiguration(configuration); // resync after getting new config
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
                                ret.push(Location.create(util.path2uri(this.root, def.fileName), {
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

    getHover(uri: string, line: number, column: number): Promise<ts.QuickInfo> {
        return this.ensureFilesForHoverAndDefinition(uri).then(() => new Promise<ts.QuickInfo>((resolve, reject) => {
            const fileName: string = util.uri2path(uri);
            try {
                const configuration = this.projectManager.getConfiguration(fileName);
                configuration.get().then(() => {
                    try {
                        this.projectManager.syncConfiguration(configuration); // resync after getting new config

                        const sourceFile = this.getSourceFile(configuration, fileName);
                        if (!sourceFile) {
                            return resolve(null);
                        }
                        const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
                        return resolve(configuration.service.getQuickInfoAtPosition(fileName, offset));
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
                configuration.get().then(() => {
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

    getWorkspaceSymbols(query: string, limit?: number): Promise<SymbolInformation[]> {
        return this.ensureFilesForWorkspaceSymbol().then(() => new Promise<SymbolInformation[]>((resolve, reject) => {
            // TODO: cache all symbols or slice of them?
            if (!query && this.workspaceSymbols) {
                return resolve(this.workspaceSymbols);
            }
            const configurations = this.projectManager.getConfigurations();
            const index = 0;
            const items = [];
            this.collectWorkspaceSymbols(query, limit, configurations, index, items, () => {
                if (!query) {
                    this.workspaceSymbols = items.sort((a, b) =>
                        a.matchKind - b.matchKind ||
                        a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()));
                }
                resolve(items);
            });
        }));
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
    private transformReference(root: string, program: ts.Program, ref: ts.ReferenceEntry): AsyncFunction<Location> {
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
    private transformNavItem(root: string, program: ts.Program, item: ts.NavigateToItem): AsyncFunction<SymbolInformation> {
        return (callback: (err?: Error, result?: SymbolInformation) => void) => {
            const sourceFile = program.getSourceFile(item.fileName);
            let start = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start);
            let end = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start + item.textSpan.length);
            callback(null, SymbolInformation.create(item.name,
                util.convertStringtoSymbolKind(item.kind),
                Range.create(start.line, start.character, end.line, end.character),
                'file:///' + item.fileName, item.containerName));
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

        configuration.get().then(() => {
            setImmediate(() => {
                this.projectManager.syncConfiguration(configuration);
                const chunkSize = limit ? Math.min(limit, limit - items.length) : undefined;
                setImmediate(() => {
                    if (query) {
                        const chunk = configuration.service.getNavigateToItems(query, chunkSize, true);
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
     * Fetches up to limit navigation bar items from given project, flattennes them  
     */
    private getNavigationTreeItems(configuration: pm.ProjectConfiguration, limit?: number): SymbolInformation[] {
        const result = [];
        const defaultLib = configuration.host.getDefaultLibFileName(configuration.host.getCompilationSettings());
        for (const sourceFile of configuration.program.getSourceFiles()) {
            if (sourceFile.fileName == defaultLib) {
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
            'file:///' + sourceFile.fileName, parent ? parent.text : '');
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
