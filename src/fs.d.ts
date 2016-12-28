/// <reference types="node" />
import { RequestType, IConnection } from 'vscode-languageserver';
export interface FileInfo {
    name: string;
    size: number;
    dir: boolean;
}
export interface FileSystem {
    readDir(path: string, callback: (err: Error, result?: FileInfo[]) => void): void;
    readFile(path: string, callback: (err: Error, result?: string) => void): void;
}
export declare namespace ReadDirRequest {
    const type: RequestType<string, FileInfo[], any>;
}
export declare namespace ReadFileRequest {
    const type: RequestType<string, string, any>;
}
export declare class RemoteFileSystem implements FileSystem {
    private connection;
    constructor(connection: IConnection);
    readDir(path: string, callback: (err: Error | null, result?: FileInfo[]) => void): void;
    readFile(path: string, callback: (err: Error | null, result?: string) => void): void;
}
export declare class LocalFileSystem implements FileSystem {
    private root;
    constructor(root: string);
    readDir(path: string, callback: (err: Error | null, result?: FileInfo[]) => void): void;
    readFile(path: string, callback: (err: Error | null, result?: string) => void): void;
}
