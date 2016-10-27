import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cluster from 'cluster';

import Connection from './connection';

const program = require('commander');

process.on('uncaughtException', (err) => {
    console.error(err);
});

const defaultLspPort = 2089;

program
    .version('0.0.1')
    .option('-s, --strict', 'Strict mode')
    .option('-p, --port [port]', 'LSP port (' + defaultLspPort + ')', parseInt)
    .parse(process.argv);

const lspPort = program.port || defaultLspPort;


const numCPUs = require('os').cpus().length;
if (cluster.isMaster) {
    console.error(`Master node process spawning ${numCPUs} workers`)
    for (let i = 0; i < numCPUs; ++i) {
        cluster.fork().on('disconnect', (worker, code, signal) => {
            console.error(`worker ${worker.process.pid} disconnect`)
        });
    }

    cluster.on('exit', (worker, code, signal) => {
        console.error(`worker ${worker.process.pid} exit (${code})`);
    });
} else {
    console.error('Listening for incoming LSP connections on', lspPort);
    var server = net.createServer(function (socket) {
        let connection = new Connection(socket, socket, program.strict);
        connection.start();
    });

    server.listen(lspPort);
}
