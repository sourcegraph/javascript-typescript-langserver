#!/usr/bin/env node

/// <reference types="vscode" />

import { TypeScriptService } from './typescript-service';
import * as server from './server';
import * as util from './util';
const program = require('commander');

const defaultLspPort = 2089;
const numCPUs = require('os').cpus().length;
process.on('uncaughtException', (err: string) => {
	console.error(err);
});

program
	.version('0.0.1')
	.option('-s, --strict', 'Strict mode')
	.option('-p, --port [port]', 'LSP port (' + defaultLspPort + ')', parseInt)
	.option('-c, --cluster [num]', 'Number of concurrent cluster workers (defaults to number of CPUs, ' + numCPUs + ')', parseInt)
	.option('-t, --trace', 'Print all requests and responses')
	.option('-l, --logfile [file]', 'Also log to this file (in addition to stderr')
	.parse(process.argv);

util.setStrict(program.strict);
const lspPort = program.port || defaultLspPort;
const clusterSize = program.cluster || numCPUs;

const options: server.ServeOptions = {
	clusterSize: clusterSize,
	lspPort: lspPort,
	strict: program.strict,
	trace: program.trace,
	logfile: program.logfile
};
server.serve(options, () => new TypeScriptService());
