/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');
var path = require('path');
var os = require('os');

var program = require('commander');

import {StreamMessageReader} from 'vscode-languageserver';

var server = net.createServer(function (socket) {

	//connect to language server
	var client = new net.Socket();
	client.connect(2089, '127.0.0.1', function () {
		console.log('Connected to language server');
	});

	socket.on('data', function (data) {
		let dataInfo = processData(data.toString());

		if (dataInfo) {
			if (dataInfo.json.method == 'initialize') {
				console.error("Inside initialize method = ");
				//Add initialization procedures here
			}
			client.write(data);
		}
	});

	client.on('data', function (data) {
        socket.write(data);
	});

});

function processData(data: string) {
	let jsonStart = data.indexOf('{');
	let jsonEnd = data.lastIndexOf('}');
	try {
		let json = JSON.parse(data.substring(jsonStart, jsonEnd + 1));
		let headers = data.substring(0, jsonStart);
		return { headers: headers, json: json };
	} catch (error) {
		console.error("Error while processing json in data sent to built server")
	}
}

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
