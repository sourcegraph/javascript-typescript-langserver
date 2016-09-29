/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');
var path = require('path');
var os = require('os');

var program = require('commander');

import Connection from './build-server-connection';

var server = net.createServer(function (socket) {
    let connection = new Connection(socket, socket, program.strict);
    connection.start();
});

process.on('uncaughtException', (err) => {
    console.error(err);
});

const defaultLspPort = 2089;

program
    .version('0.0.1')
    .option('-s, --strict', 'Strict mode')
    .option('-p, --port [port]', 'LSP port (' + defaultLspPort + ')', parseInt)
    .parse(process.argv);

const lspPort = program.port || defaultLspPort;

console.error('Build server: listening for incoming LSP connections on', lspPort);

server.listen(lspPort);
