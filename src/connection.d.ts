import { IConnection } from 'vscode-languageserver';
import { LanguageHandler } from './lang-handler';
export declare function newConnection(input: any, output: any): IConnection;
export declare function registerLanguageHandler(connection: IConnection, strict: boolean, handler: LanguageHandler): void;
