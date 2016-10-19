/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>
/// <reference path="../typings/async/async.d.ts"/>

import * as path_ from 'path';
import * as fs from 'fs';

import * as ts from 'typescript';
import {IConnection} from 'vscode-languageserver';
import * as async from 'async';

import * as FileSystem from './fs';
/**
 * Script entry, allows to keep content in memory
 */
class ScriptEntry {
    content: string;
    version: number;

    constructor(content: string) {
        this.content = content;
        this.version = 0;
    }

    /**
     * Updates script entry with new content, increments version automatically
     */
    update(content: string) {
        this.content = content;
        this.version++;
    }
}

/**
 * Language service host that manages versioned script entries and allows to switch between
 * in-memory mode (managed by didOpen notifications) and FS scan mode when host scans for files
 */
export default class VersionedLanguageServiceHost implements ts.LanguageServiceHost {

    root: string;
    strict: boolean;

    entries: Map<string, ScriptEntry>;
    compilerOptions: ts.CompilerOptions = {module: ts.ModuleKind.CommonJS, allowNonTsExtensions: true, allowJs: true};

    fs: FileSystem.FileSystem;

    constructor(root: string, strict: boolean, connection: IConnection) {
        this.root = root;
        this.strict = strict;
        this.entries = new Map<string, ScriptEntry>();

        if (strict) {
            this.fs = new FileSystem.RemoteFileSystem(connection)
        } else {
            this.fs = new FileSystem.LocalFileSystem(root)
        }
    }

    initialize(root: string): Promise<void> {

        let self = this;

        return new Promise<void>(function(resolve, reject) {
            self.getFiles(root, function (err, files) {
                if (err) {
                    console.error('An error occurred while collecting files', err);
                    return reject(err);
                }
                self.processTsConfig(root, files, function(err?: Error, files?: string[]) {
                    const start = new Date().getTime();
                    if (err) {
                        console.error('An error occurred while collecting files', err);
                        return reject(err);
                    }
                    let tasks = [];
                    const fetch = function (path: string): AsyncFunction<string> {
                        return function (callback: (err?: Error, result?: string) => void) {
                            self.fs.readFile(path, (err?: Error, result?: string) => {
                                if (err) {
                                    console.error('Unable to fetch content of ' + path, err);
                                    return callback(err)
                                }
                                const rel = path_.posix.relative(root, path);
                                self.addFile(rel, result);
                                return callback()
                            })
                        }
                    };
                    files.forEach(function (path) {
                        tasks.push(fetch(path))
                    });
                    async.parallel(tasks, function (err) {
                        console.error('files fetched in', (new Date().getTime() - start) / 1000.0);
                        return err ? reject(err) : resolve();
                    })
                });
            });
        });
    }

    getCompilationSettings(): ts.CompilerOptions {
        return this.compilerOptions;
    }

    getScriptFileNames(): string[] {
        return Array.from(this.entries.keys());
    }

    getScriptVersion(fileName: string): string {
        let entry = this.entries.get(fileName);
        return entry ? '' + entry.version : undefined;
    }

    getScriptSnapshot(fileName: string): ts.IScriptSnapshot {
        let entry = this.entries.get(fileName);
        if (!entry) {
            return undefined;
        }
        if (this.strict || entry.content) {

            return ts.ScriptSnapshot.fromString(entry.content);
        }

        const fullPath = this.resolvePath(fileName);
        if (!fs.existsSync(fullPath)) {
            return undefined;
        }
        return ts.ScriptSnapshot.fromString(fs.readFileSync(fullPath).toString());
    }

    getCurrentDirectory(): string {
        return this.root;
    }

    getDefaultLibFileName(options: ts.CompilerOptions): string {
        return ts.getDefaultLibFilePath(options);
    }

    addFile(name, content: string) {
        let entry = this.entries.get(name);
        if (entry) {
            entry.update(content);
        } else {
            this.entries.set(name, new ScriptEntry(content));
        }
    }

    removeFile(name) {
        this.entries.delete(name);
    }

    hasFile(name) {
        return this.entries.has(name);
    }

    private resolvePath(p: string): string {
        return path_.resolve(this.root, p);
    }

    private fetchDir(path: string): AsyncFunction<FileSystem.FileInfo[]> {
        let self = this;
        return function (callback: (err?: Error, result?: FileSystem.FileInfo[]) => void) {
            self.fs.readDir(path, (err?: Error, result?: FileSystem.FileInfo[]) => {
                if (result) {
                    result.forEach(function (fi) {
                        fi.Name_ = path_.posix.join(path, fi.Name_)
                    })
                }
                return callback(err, result)
            });
        }
    }

    getFiles(path: string, callback: (err: Error, result?: string[]) => void) {

        const start = new Date().getTime();

        let self = this;
        let files: string[] = [];
        let counter: number = 0;

        let cb = function (err: Error, result?: FileSystem.FileInfo[]) {
            if (err) {
                console.error('got error while reading dir', err);
                return callback(err)
            }
            let tasks = [];
            result.forEach(function (fi) {
                if (fi.Name_.indexOf('/.') >= 0) {
                    return
                }
                if (fi.Dir_) {
                    counter++;
                    tasks.push(self.fetchDir(fi.Name_))
                } else {
                    if (/\.(ts|js)x?$/.test(fi.Name_) || /(^|\/)(ts|js)config\.json$/.test(fi.Name_)) {
                        files.push(fi.Name_)
                    }
                }
            });
            async.parallel(tasks, function (err: Error, result?: FileSystem.FileInfo[][]) {
                if (err) {
                    return callback(err)
                }
                result.forEach((items) => {
                    counter--;
                    cb(null, items)
                });
                if (counter == 0) {
                    console.error(files.length + ' found, fs scan complete in', (new Date().getTime() - start) / 1000.0);
                    callback(null, files)
                }
            })
        };
        this.fetchDir(path)(cb)
    }

    private processTsConfig(root: string, files: string[], callback: (err?: Error, result?: string[]) => void) {
        const tsConfig = files.find(function(value: string): boolean {
            return /(^|\/)tsconfig\.json$/.test(value)
        });
        if (tsConfig) {
            this.fs.readFile(tsConfig, (err?: Error, result?: string) => {
                if (err) {
                    return callback(err)
                }
                var jsonConfig = ts.parseConfigFileTextToJson(tsConfig, result);
                if (jsonConfig.error) {
                    return callback(new Error('Cannot parse tsconfig.json'))
                }
                var configObject = jsonConfig.config;
                // TODO: VFS - add support of includes/excludes
                const parseConfigHost = {
                    useCaseSensitiveFileNames: true,
                    readDirectory: function(): string[] {
                        return []
                    },
                    fileExists: function(): boolean {
                        return true
                    }
                };
                
                let base = path_.posix.relative(root, path_.posix.dirname(tsConfig));
                if (!base) {
                    base = root;
                }
                var configParseResult = ts.parseJsonConfigFileContent(configObject, parseConfigHost, base);
                this.compilerOptions = configParseResult.options;                
/*
                if (configParseResult.fileNames && configParseResult.fileNames.length) {
                    files = [];
                    configParseResult.fileNames.forEach(fileName => {
                        files.push(fileName);
                    });
                }
*/
                return callback(null, files);
            });
        } else {
            return callback(null, files);
        }
    }
}
