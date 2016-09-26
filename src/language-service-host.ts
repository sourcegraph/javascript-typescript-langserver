/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>
import * as path from 'path';
import * as fs from 'fs';

import * as ts from 'typescript';

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
    compilerOptions: ts.CompilerOptions = { module: ts.ModuleKind.CommonJS, allowNonTsExtensions: true, allowJs: true };

    constructor(root: string, strict: boolean) {
        this.root = root;
        this.strict = strict;
        this.entries = new Map<string, ScriptEntry>();

        //process tsconfig.json file
        try {
            let configFileName = ts.findConfigFile(root, ts.sys.fileExists);
            if (configFileName) {
                var result = ts.parseConfigFileTextToJson(configFileName, ts.sys.readFile(configFileName));
                var configObject = result.config;
                var configParseResult = ts.parseJsonConfigFileContent(configObject, ts.sys, root);
                this.compilerOptions = configParseResult.options;
                if (configParseResult.fileNames) {
                    configParseResult.fileNames.forEach(fileName => {
                        let rname = path.relative(root, fileName);
                        this.entries.set(rname, new ScriptEntry(null));
                    });
                } else {
                    if (!strict) {
                        this.getFiles(root, '');
                    }
                }
                // if tsconfig.json not found, add all files with extensions
            } else {
                if (!strict) {
                    this.getFiles(root, '');
                }
            }
        } catch (error) {
            console.error("Error in config file processing");
            if (!strict) {
                this.getFiles(root, '');
            }
        }
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
        return path.join(__dirname, '../src/defs/merged.lib.d.ts');
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
        return path.resolve(this.root, p);
    }

    private getFiles(root: string, prefix: string) {
        const dir: string = path.join(root, prefix);
        const self = this;
        if (!fs.existsSync(dir)) {
            return
        }
        if (fs.statSync(dir).isDirectory()) {
            fs.readdirSync(dir).filter(function (name) {
                if (name[0] == '.') {
                    return false;
                }
                if (name == 'node_modules') {
                    return false;
                }
                return /\.[tj]sx?$/.test(name) || fs.statSync(path.join(dir, name)).isDirectory();
            }).forEach(function (name) {
                self.getFiles(root, path.posix.join(prefix, name))
            })
        } else {
            this.entries.set(prefix, new ScriptEntry(null));
        }
    }

}
