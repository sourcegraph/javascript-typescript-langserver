/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/async/async.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { IConnection, Position, Location, SymbolInformation, Range } from 'vscode-languageserver';

import * as async from 'async';

import * as util from './util';
import * as pm from './project-manager';

import ExportedSymbolsProvider from './exported-symbols-provider'
import ExternalRefsProvider from './external-refs-provider';

var sanitizeHtml = require('sanitize-html');
var JSONPath = require('jsonpath-plus');

var github = require('download-github-repo');

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

        this.fetchDefinetelyTypedRepo();

        //initialize providers 
        this.exportedSymbolProvider = new ExportedSymbolsProvider(this);
        this.externalRefsProvider = new ExternalRefsProvider(this);
    }

    fetchDefinetelyTypedRepo() {
        //TODO add checking that repo is already fetched
        github('DefinitelyTyped/DefinitelyTyped', '/tmp/DefinitelyTyped', function (err) {
            if (err) {
                console.error("Error downloading DefinitelyTyped repo ", err);
            } else {
                console.error("DefinitelyTyped repo downloading completed");
            }
        });
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

    getDefinition(uri: string, line: number, column: number): Promise<Location[]> {
        const self = this;
        return new Promise<Location[]>(function (resolve, reject) {
            try {
                const fileName: string = util.uri2path(uri);
                const configuration = self.projectManager.getConfiguration(fileName);
                configuration.get().then(function () {
                    try {
                        const sourceFile = self.getSourceFile(configuration, fileName);
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

                                let pathParts = def.fileName.split(path.sep);
                                let index1 = pathParts.indexOf("node_modules")
                                let index2 = pathParts.indexOf("@types");
                                if (index2 - index1 == 1) {
                                    let dtsFolder = pathParts[index2 + 1];
                                    let dtsFileName = configuration.dtsNames[dtsFolder];
                                    ret.push(Location.create(`https://github.com/DefinitelyTyped/DefinitelyTyped/${dtsFolder}/${dtsFileName}`, {
                                        start: start,
                                        end: end
                                    }));
                                } else {
                                    ret.push(Location.create(util.path2uri(self.root, def.fileName), {
                                        start: start,
                                        end: end
                                    }));
                                }
                            }
                        }
                        return resolve(ret);
                    } catch (e) {
                        return reject(e);
                    }

                }, function (e) {
                    return reject(e);
                });
            } catch (e) {
                return reject(e);
            }
        });
    }

    getHover(uri: string, line: number, column: number): Promise<ts.QuickInfo> {
        const self = this;
        return new Promise<ts.QuickInfo>(function (resolve, reject) {
            try {
                const fileName: string = util.uri2path(uri);
                const configuration = self.projectManager.getConfiguration(fileName);
                configuration.get().then(function () {
                    try {
                        const sourceFile = self.getSourceFile(configuration, fileName);
                        if (!sourceFile) {
                            return resolve(null);
                        }
                        const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
                        return resolve(configuration.service.getQuickInfoAtPosition(fileName, offset));
                    } catch (e) {
                        return reject(e);
                    }
                }, function (e) {
                    return reject(e);
                });
            } catch (e) {
                return reject(e);
            }
        });
    }

    getReferences(uri: string, line: number, column: number): Promise<Location[]> {
        const self = this;
        return new Promise<Location[]>(function (resolve, reject) {
            try {
                const fileName: string = util.uri2path(uri);

                const configuration = self.projectManager.getConfiguration(fileName);
                configuration.get().then(function () {
                    try {
                        const sourceFile = self.getSourceFile(configuration, fileName);
                        if (!sourceFile) {
                            return resolve([]);
                        }

                        const started = new Date().getTime();

                        self.projectManager.syncConfigurationFor(fileName);

                        const prepared = new Date().getTime();

                        const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
                        const refs = configuration.service.getReferencesAtPosition(fileName, offset);

                        const fetched = new Date().getTime();
                        const ret = [];
                        const tasks = [];

                        if (refs) {
                            for (let ref of refs) {
                                tasks.push(self.transformReference(self.root, configuration.program, ref));
                            }
                        }
                        async.parallel(tasks, function (err: Error, results: Location[]) {
                            const finished = new Date().getTime();
                            console.error('references', 'transform', (finished - fetched) / 1000.0, 'fetch', (fetched - prepared) / 1000.0, 'prepare', (prepared - started) / 1000.0);
                            return resolve(results);
                        });

                    } catch (e) {
                        return reject(e);
                    }
                }, function (e) {
                    return reject(e);
                });

            } catch (e) {
                return reject(e);
            }
        });
    }

    getWorkspaceSymbols(query: string, limit?: number): Promise<SymbolInformation[]> {
        const self = this;
        return new Promise<SymbolInformation[]>(function (resolve, reject) {
            // TODO: cache all symbols or slice of them?
            if (!query && self.workspaceSymbols) {
                return resolve(self.workspaceSymbols);
            }
            const configurations = self.projectManager.getConfigurations();
            const index = 0;
            const items = [];
            self.collectWorkspaceSymbols(query, limit, configurations, index, items, function () {
                if (!query) {
                    self.workspaceSymbols = items;
                }
                resolve(items);
            });
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
        // HACK (alexsaveliev) using custom method to add a file
        configuration.host.incProjectVersion();
        configuration.program.addFile(fileName);
        // requery program object to synchonize LanguageService's data
        configuration.program = configuration.service.getProgram();
        return configuration.program.getSourceFile(fileName);
    }

    /**
     * Produces async function that converts ReferenceEntry object to Location
     */
    private transformReference(root: string, program: ts.Program, ref: ts.ReferenceEntry): AsyncFunction<Location> {
        return function (callback: (err?: Error, result?: Location) => void) {
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
        return function (callback: (err?: Error, result?: SymbolInformation) => void) {
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
        const self = this;
        configuration.get().then(function () {
            self.projectManager.syncConfiguration(configuration);
            const chunkSize = limit ? Math.min(limit, limit - items.length) : undefined;
            const chunk = configuration.service.getNavigateToItems(query, chunkSize);
            const tasks = [];
            chunk.forEach(function (item) {
                tasks.push(self.transformNavItem(self.root, configuration.program, item));
            });
            async.parallel(tasks, function (err: Error, results: SymbolInformation[]) {
                Array.prototype.push.apply(items, results);
                if (limit && items.length >= limit || index == configurations.length - 1) {
                    return callback();
                }
                self.collectWorkspaceSymbols(query, limit, configurations, index + 1, items, callback);
            });
        }, function () {
            return callback();
        });
    }

}
