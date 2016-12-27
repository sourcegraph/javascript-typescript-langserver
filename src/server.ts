/// <reference path="../node_modules/vscode/thenable.d.ts" />

import {
	IConnection,
} from 'vscode-languageserver';

import * as net from 'net';
import * as cluster from 'cluster';

import { newConnection, registerLanguageHandler } from './connection';
import { registerMasterHandler } from './master-connection';
import { LanguageHandler } from './lang-handler';
import * as fs from './fs';

const workersReady = new Map<string, Promise<void>>();

function randomNWorkers(n: number): string[] {
	const unselected = Array.from(workersReady.keys());
	let numUnselected = unselected.length;
	const selected: string[] = [];
	for (let i = 0; i < n; i++) {
		const s = Math.floor(Math.random() * numUnselected);
		selected.push(unselected[s]);
		const a = unselected[numUnselected - 1], b = unselected[s];
		unselected[numUnselected - 1] = b, unselected[s] = a;
		numUnselected--;
	}
	return selected;
}

async function rewriteConsole() {
	const consoleErr = console.error;
	console.error = function () {
		if (cluster.isMaster) {
			consoleErr(`[mstr]`, ...arguments);
		} else {
			consoleErr(`[wkr${cluster.worker.id}]`, ...arguments);
		}
	}
}

/**
 * serve starts a singleton language server instance that uses a
 * cluster of worker processes to achieve some semblance of
 * parallelism.
 */
export async function serve(clusterSize: number, lspPort: number, strict: boolean, newLangHandler: () => LanguageHandler): Promise<void> {
	rewriteConsole();

	if (cluster.isMaster) {
		console.error(`spawning ${clusterSize} workers`)
		for (let i = 0; i < clusterSize; ++i) {
			const worker = cluster.fork().on('disconnect', () => {
				console.error(`worker ${worker.process.pid} disconnect`)
			});

			workersReady.set(worker.id, new Promise<void>((resolve, reject) => {
				worker.on('listening', resolve);
			}));
		}

		cluster.on('exit', (worker, code, signal) => {
			const reason = code === null ? signal : code;
			console.error(`worker ${worker.process.pid} exit (${reason})`);
		});

		var server = net.createServer(async (socket) => {
			const connection = newConnection(socket, socket);

			// Create connections to two worker servers
			const workerIds = randomNWorkers(2);
			await Promise.all(workerIds.map((id) => workersReady.get(id)));

			const workerConns = await Promise.all(workerIds.map((id) => new Promise<IConnection>((resolve, reject) => {
				const clientSocket = net.createConnection({ port: lspPort + parseInt(id) }, () => {
					resolve(newConnection(clientSocket, clientSocket));
				});
			})));
			for (const workerConn of workerConns) {
				workerConn.onRequest(fs.ReadDirRequest.type, async (params: string): Promise<fs.FileInfo[]> => {
					return connection.sendRequest(fs.ReadDirRequest.type, params);
				});
				workerConn.onRequest(fs.ReadFileRequest.type, async (params: string): Promise<string> => {
					return connection.sendRequest(fs.ReadFileRequest.type, params);
				});
				workerConn.listen();
			}

			console.error(`connected to workers ${workerIds[0]} and ${workerIds[1]}`);

			registerMasterHandler(connection, workerConns[0], workerConns[1]);
			connection.listen();
			console.error("established connection to client");
		});
		console.error(`listening for incoming LSP connections on ${lspPort} `);
		server.listen(lspPort);

	} else {
		console.error(`listening for incoming LSP connections on ${lspPort + cluster.worker.id} `);
		var server = net.createServer((socket) => {
			const connection = newConnection(socket, socket);
			registerLanguageHandler(connection, strict, newLangHandler());
			connection.listen();
			console.error("established connection to master");
		});
		server.listen(lspPort + parseInt(cluster.worker.id));
	}
}
