#!/usr/bin/env node
"use strict";
const connection_1 = require("./connection");
const typescript_service_1 = require("./typescript-service");
const util = require("./util");
var program = require('commander');
process.on('uncaughtException', (err) => {
    console.error(err);
});
program
    .version('0.0.1')
    .option('-s, --strict', 'Strict mode')
    .option('-t, --trace', 'Print all requests and responses')
    .option('-l, --logfile [file]', 'Also log to this file (in addition to stderr')
    .parse(process.argv);
util.setStrict(program.strict);
const connection = connection_1.newConnection(process.stdin, process.stdout, { trace: program.trace, logfile: program.logfile });
connection_1.registerLanguageHandler(connection, program.strict, new typescript_service_1.TypeScriptService());
connection.listen();
//# sourceMappingURL=language-server-stdio.js.map