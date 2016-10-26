/// <reference path="../../typings/node/node.d.ts"/>
/// <reference path="../../typings/tmp/tmp.d.ts"/>
/// <reference path="../../typings/mocha/mocha.d.ts"/>
/// <reference path="../../typings/chai/chai.d.ts"/>

import * as net from 'net';
import * as os from 'os';
import * as fs from 'fs';

import * as tmp from 'tmp';
import * as mocha from 'mocha';
import * as chai from 'chai';

import * as vscode from 'vscode-languageserver';

import Connection from '../connection';
import {FileInfo} from '../fs';
import * as rt from '../request-type';
import * as utils from './test-utils';

class Channel {
    server: net.Server;
    serverIn: net.Socket;
    serverOut: net.Socket;
    serverFile: string;
    serverConnection: Connection;

    client: net.Server;
    clientIn: net.Socket;
    clientOut: net.Socket;
    clientFile: string;
    clientConnection: Connection;
}

let channel: Channel;

export function setUp(memfs: any, done: (err?: Error) => void) {

    channel = new Channel();

    const input = tmp.fileSync();
    const output = tmp.fileSync();

    fs.unlinkSync(input.name);
    fs.unlinkSync(output.name);

    channel.serverFile = input.name;
    channel.clientFile = output.name;

    let counter = 2;

    function maybeDone() {
        counter--;
        if (counter === 0) {
            channel.serverConnection.start();
            channel.clientConnection.start();

            const params: vscode.InitializeParams = {
                processId: null,
                rootPath: 'file:///',
                capabilities: null
            }

            channel.clientConnection.sendRequest(rt.InitializeRequest.type, params).then(function () {
                done();
            }, function () {
                console.error(arguments);
                return done(new Error('initialization failed'));
            });
        }
    }

    channel.server = net.createServer(function (stream) {
        channel.serverIn = stream;
        channel.serverConnection = new Connection(channel.serverIn, channel.serverOut, true);
        maybeDone();
    });
    channel.server.listen(input.name);
    channel.client = net.createServer(function (stream) {
        channel.clientIn = stream;
        channel.clientConnection = new Connection(channel.clientIn, channel.clientOut, true);
        initFs(channel.clientConnection, memfs);
        maybeDone();
    });
    channel.client.listen(output.name);
    channel.clientOut = net.connect(input.name);
    channel.serverOut = net.connect(output.name);
}

function initFs(connection: Connection, memfs: any) {
    connection.connection.onRequest(rt.ReadDirRequest.type, (params: string): FileInfo[] => {
        params = params.substring(1);
        const path = params.length ? params.split('/') : [];
        let node = memfs;
        let i = 0;
        while (i < path.length) {
            node = node[path[i]];
            if (!node || typeof node != 'object') {
                throw new Error('no such file');
            }
            i++;
        }
        const keys = Object.keys(node);
        let result = []
        keys.forEach((k) => {
            const v = node[k];
            if (typeof v == 'string') {
                result.push({
                    name: k,
                    size: v.length,
                    dir: false
                })
            } else {
                result.push({
                    name: k,
                    size: 0,
                    dir: true
                });
            }
        });
        return result;
    });

    connection.connection.onRequest(rt.ReadFileRequest.type, (params: string): string => {
        params = params.substring(1);
        const path = params.length ? params.split('/') : [];
        let node = memfs;
        let i = 0;
        while (i < path.length - 1) {
            node = node[path[i]];
            if (!node || typeof node != 'object') {
                throw new Error('no such file');
            }
            i++;
        }
        const content = node[path[path.length - 1]];
        if (!content || typeof content != 'string') {
            throw new Error('no such file');
        }
        return new Buffer(content).toString('base64');
    });
}

export function tearDown(done: () => void) {
    channel.client.close();
    channel.server.close();
    done();
}

function check(done: (err?: Error) => void, conditions: () => void) {
    try {
        conditions();
        done();
    } catch (err) {
        done(err);
    }
}

export function definition(pos: vscode.TextDocumentPositionParams, expected: vscode.Location, done: (err?: Error) => void) {
    channel.clientConnection.sendRequest(rt.DefinitionRequest.type, {
        textDocument: {
            uri: pos.textDocument.uri
        },
        position: {
            line: pos.position.line,
            character: pos.position.character
        }
    }).then(function (results: vscode.Location[]) {
        check(done, function () {
            chai.expect(results.length).to.equal(1);
            const result = results[0];
            chai.expect(result).to.deep.equal(expected);
        });
    }, function (err?: Error) {
        return done(err || new Error('definition request failed'))
    })
}

export function hover(pos: vscode.TextDocumentPositionParams, expected: vscode.Hover, done: (err?: Error) => void) {
    channel.clientConnection.sendRequest(rt.HoverRequest.type, {
        textDocument: {
            uri: pos.textDocument.uri
        },
        position: {
            line: pos.position.line,
            character: pos.position.character
        }
    }).then(function (result: vscode.Hover) {
        check(done, function () {
            chai.expect(result.contents).to.deep.equal(expected.contents);
        });
    }, function (err?: Error) {
        return done(err || new Error('hover request failed'))
    })
}

export function references(pos: vscode.TextDocumentPositionParams, expected: number, done: (err?: Error) => void) {
    channel.clientConnection.sendRequest(rt.ReferencesRequest.type, {
        textDocument: {
            uri: pos.textDocument.uri
        },
        position: {
            line: pos.position.line,
            character: pos.position.character
        }
    }).then(function (result: vscode.Location[]) {
        check(done, function () {
            chai.expect(result.length).to.equal(expected);
        });
    }, function (err?: Error) {
        return done(err || new Error('references request failed'))
    })
}

