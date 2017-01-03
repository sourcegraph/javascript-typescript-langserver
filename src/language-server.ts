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
	.parse(process.argv);

util.setStrict(program.strict);
const lspPort = program.port || defaultLspPort;
const clusterSize = program.cluster || numCPUs;

server.serve(clusterSize, lspPort, program.strict, () => new TypeScriptService());
