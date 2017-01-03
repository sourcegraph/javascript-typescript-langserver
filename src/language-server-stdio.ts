#!/usr/bin/env node

import { newConnection, registerLanguageHandler } from './connection';
import { TypeScriptService } from './typescript-service';
import * as util from './util';

var program = require('commander');

process.on('uncaughtException', (err: string) => {
	console.error(err);
});

program
	.version('0.0.1')
	.option('-s, --strict', 'Strict mode')
	.parse(process.argv);

util.setStrict(program.strict);
const connection = newConnection(process.stdin, process.stdout);
registerLanguageHandler(connection, program.strict, new TypeScriptService());
connection.listen();
