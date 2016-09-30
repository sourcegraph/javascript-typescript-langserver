/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');
var path = require('path');
var os = require('os');

var program = require('commander');

var server = net.createServer(function (socket) {

	//connect to language server
	var client = new net.Socket();
	//just for testing purposes now, check that build server calls langserver - but it works
	client.connect(2089, '127.0.0.1', function () {
		console.log('Connected to language server');
	});

	socket.on('data', function (data) {
		client.write(data);
	});

	client.on('data', function (data) {
        socket.write(data);
	});

});

process.on('uncaughtException', (err) => {
    console.error(err);
});

const defaultBuildPort = 2088;

program
    .version('0.0.1')
    .option('-s, --strict', 'Strict mode')
    .option('-p, --port [port]', 'LSP port (' + defaultBuildPort + ')', parseInt)
    .parse(process.argv);

const lspPort = program.port || defaultBuildPort;

console.error('Build server: listening for incoming LSP connections on', lspPort);

server.listen(lspPort);
