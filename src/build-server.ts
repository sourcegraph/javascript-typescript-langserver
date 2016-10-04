/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');
var path = require('path');
var os = require('os');

var program = require('commander');
var glob = require("glob")

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
                let root = dataInfo.json.params.rootPath;

				//find tsconfig.json file and update rootPath
				try {
					process.chdir(root);
					glob("**/tsconfig.json", function (err, files) {
						if (err) throw err;
						let resolvedFiles = [];
						files = files.forEach(function (match) {
							if (match.indexOf("node_modules") == -1) {
								resolvedFiles.push(match);
							}
							return path.relative(root, match);
						});

                        //TODO process multiple tsconfig.json in one project
						//For now we process only 1 folder with tsconfig.json
						let resolvedFile = resolvedFiles[0];
						let newPath = path.join(root, path.dirname(resolvedFile));
						dataInfo.json.params.rootPath = newPath;

						//Write data with updated root path to client
						let dataBuffer = new Buffer(JSON.stringify(dataInfo.json), "utf-8");
						client.write(new Buffer(updateHeaders(dataBuffer.byteLength, dataInfo.headers), "utf-8"));
						client.write(dataBuffer);
					})

				} catch (error) {
					console.error("Error in config file processing");
				}
			} else {
				client.write(data);
			}
		}
	});

	client.on('data', function (data) {
        socket.write(data);
	});

});

function updateHeaders(length, headers) {
	let CRLF = '\r\n';
	let headersData = headers.split(CRLF);
	let result = "";

	headersData.forEach(function (header) {
		if (header.length > 0) {
			var index = header.indexOf(':');
			if (index === -1) {
				throw new Error('Message header must separate key and value using :');
			}
			var key = header.substr(0, index);
			var value = header.substr(index + 1).trim();

			if (key == "Content-Length") {
				result = result + "Content-Length:" + length + CRLF;
			} else {
				result = result + header;
			}
		} else {
			result = result + header + CRLF;
		}
	});

	return result;

}

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
