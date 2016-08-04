/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

import * as ts from "typescript";
import TypeScriptService from './typescript';

import {
	createConnection, IConnection,
} from 'vscode-languageserver';

export default class Connection {

    connection: IConnection;
    service: TypeScriptService;

    constructor(socket: any) {
        this.connection = createConnection(socket, socket);
        // TODO
        socket.removeAllListeners('end');
        socket.removeAllListeners('close');
    }

}
