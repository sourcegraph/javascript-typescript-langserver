#!/usr/bin/env node

import { RemoteLanguageClient } from './lang-handler';
import { FileLogger, StdioLogger } from './logging';
import { serve, ServeOptions } from './server';
import { TypeScriptService, TypeScriptServiceOptions } from './typescript-service';
import * as util from './util';
const program = require('commander');
const packageJson = require('../package.json');

const defaultLspPort = 2089;
const numCPUs = require('os').cpus().length;

program
	.version(packageJson.version)
	.option('-s, --strict', 'enabled strict mode')
	.option('-p, --port [port]', 'specifies LSP port to use (' + defaultLspPort + ')', parseInt)
	.option('-c, --cluster [num]', 'number of concurrent cluster workers (defaults to number of CPUs, ' + numCPUs + ')', parseInt)
	.option('-t, --trace', 'print all requests and responses')
	.option('-l, --logfile [file]', 'log to this file')
	.parse(process.argv);

util.setStrict(program.strict);
const lspPort = program.port || defaultLspPort;
const clusterSize = program.cluster || numCPUs;
const logger = program.logfile ? new FileLogger(program.logfile) : new StdioLogger();
util.setLogger(logger);

const options: ServeOptions & TypeScriptServiceOptions = {
	clusterSize,
	lspPort,
	strict: program.strict,
	trace: program.trace,
	logger
};
serve(options, connection => new TypeScriptService(new RemoteLanguageClient(connection), options));
