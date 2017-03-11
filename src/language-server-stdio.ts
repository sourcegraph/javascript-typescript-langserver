#!/usr/bin/env node

import { newConnection, registerLanguageHandler } from './connection';
import { RemoteLanguageClient } from './lang-handler';
import { TypeScriptService } from './typescript-service';
import * as util from './util';

const packageJson = require('../package.json');
const program = require('commander');

process.on('uncaughtException', (err: string) => {
	console.error(err);
});

program
	.version(packageJson.version)
	.option('-s, --strict', 'enables strict mode')
	.option('-t, --trace', 'print all requests and responses')
	.option('-l, --logfile [file]', 'also log to this file (in addition to stderr)')
	.parse(process.argv);

util.setStrict(program.strict);
const connection = newConnection(process.stdin, process.stdout, { trace: program.trace, logfile: program.logfile });
registerLanguageHandler(connection, new TypeScriptService(new RemoteLanguageClient(connection), {
	strict: program.strict
}));
connection.listen();
