#!/usr/bin/env node

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

const options: ServeOptions & TypeScriptServiceOptions = {
	clusterSize: program.cluster || numCPUs,
	lspPort: program.port || defaultLspPort,
	strict: program.strict,
	logMessages: program.trace,
	logger: program.logfile ? new FileLogger(program.logfile) : new StdioLogger()
};

serve(options, client => new TypeScriptService(client, options));
