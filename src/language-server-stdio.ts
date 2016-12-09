var fs = require('fs');
var path = require('path');
var os = require('os');

var program = require('commander');

import { newConnection, registerLanguageHandler } from './connection';
import { TypeScriptService } from './typescript-service';
import * as util from './util';

process.on('uncaughtException', (err) => {
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
