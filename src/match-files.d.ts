/**
 * This file contains subset of functions copied over from src/compiler/sys.ts and src/compiler/core.ts of microsoft/typescript.
 * The purpose is to expose `matchFiles` helper function
 */
export interface FileSystemEntries {
    files: string[];
    directories: string[];
}
export declare function matchFiles(path: string, extensions: string[], excludes: string[], includes: string[], useCaseSensitiveFileNames: boolean, currentDirectory: string, getFileSystemEntries: (path: string) => FileSystemEntries): string[];
