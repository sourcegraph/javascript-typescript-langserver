var fs = require('fs');
var path = require('path');
var os = require('os');

var program = require('commander');

import Connection from './connection';

process.on('uncaughtException', (err) => {
    console.error(err);
});

program
    .version('0.0.1')
    .option('-s, --strict', 'Strict mode')
    .parse(process.argv);

let connection = new Connection(process.stdin, process.stdout, program.strict);
connection.start();
