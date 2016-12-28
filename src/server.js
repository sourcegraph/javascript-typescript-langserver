"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const net = require("net");
const cluster = require("cluster");
const connection_1 = require("./connection");
const master_connection_1 = require("./master-connection");
const fs = require("./fs");
const workersReady = new Map();
function randomNWorkers(n) {
    const unselected = Array.from(workersReady.keys());
    let numUnselected = unselected.length;
    const selected = [];
    for (let i = 0; i < n; i++) {
        const s = Math.floor(Math.random() * numUnselected);
        selected.push(unselected[s]);
        const a = unselected[numUnselected - 1], b = unselected[s];
        unselected[numUnselected - 1] = b, unselected[s] = a;
        numUnselected--;
    }
    return selected;
}
function rewriteConsole() {
    return __awaiter(this, void 0, void 0, function* () {
        const consoleErr = console.error;
        console.error = function () {
            if (cluster.isMaster) {
                consoleErr(`[mstr]`, ...arguments);
            }
            else {
                consoleErr(`[wkr${cluster.worker.id}]`, ...arguments);
            }
        };
    });
}
/**
 * serve starts a singleton language server instance that uses a
 * cluster of worker processes to achieve some semblance of
 * parallelism.
 */
function serve(clusterSize, lspPort, strict, newLangHandler) {
    return __awaiter(this, void 0, void 0, function* () {
        if (clusterSize < 2) {
            throw new Error("clusterSize should be at least 2");
        }
        rewriteConsole();
        if (cluster.isMaster) {
            console.error(`spawning ${clusterSize} workers`);
            for (let i = 0; i < clusterSize; ++i) {
                const worker = cluster.fork().on('disconnect', () => {
                    console.error(`worker ${worker.process.pid} disconnect`);
                });
                workersReady.set(worker.id, new Promise((resolve, reject) => {
                    worker.on('listening', resolve);
                }));
            }
            cluster.on('exit', (worker, code, signal) => {
                const reason = code === null ? signal : code;
                console.error(`worker ${worker.process.pid} exit (${reason})`);
            });
            var server = net.createServer((socket) => __awaiter(this, void 0, void 0, function* () {
                const connection = connection_1.newConnection(socket, socket);
                // Create connections to two worker servers
                const workerIds = randomNWorkers(2);
                yield Promise.all(workerIds.map((id) => workersReady.get(id)));
                const workerConns = yield Promise.all(workerIds.map((id) => new Promise((resolve, reject) => {
                    const clientSocket = net.createConnection({ port: lspPort + parseInt(id) }, () => {
                        resolve(connection_1.newConnection(clientSocket, clientSocket));
                    });
                })));
                for (const workerConn of workerConns) {
                    workerConn.onRequest(fs.ReadDirRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
                        return connection.sendRequest(fs.ReadDirRequest.type, params);
                    }));
                    workerConn.onRequest(fs.ReadFileRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
                        return connection.sendRequest(fs.ReadFileRequest.type, params);
                    }));
                    workerConn.listen();
                }
                console.error(`connected to workers ${workerIds[0]} and ${workerIds[1]}`);
                master_connection_1.registerMasterHandler(connection, workerConns[0], workerConns[1]);
                connection.listen();
                console.error("established connection to client");
            }));
            console.error(`listening for incoming LSP connections on ${lspPort} `);
            server.listen(lspPort);
        }
        else {
            console.error(`listening for incoming LSP connections on ${lspPort + cluster.worker.id} `);
            var server = net.createServer((socket) => {
                const connection = connection_1.newConnection(socket, socket);
                connection_1.registerLanguageHandler(connection, strict, newLangHandler());
                connection.listen();
                console.error("established connection to master");
            });
            server.listen(lspPort + parseInt(cluster.worker.id));
        }
    });
}
exports.serve = serve;
//# sourceMappingURL=server.js.map