import * as net from 'net';
import * as cluster from 'cluster';

import { newConnection, registerLanguageHandler } from './connection';
import { LanguageHandler } from './lang-handler';

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
		console.error(`Master node process spawning ${clusterSize} workers`)
		for (let i = 0; i < clusterSize; ++i) {
			const worker = cluster.fork().on('disconnect', () => {
				console.error(`worker ${worker.process.pid} disconnect`)
			});
		}

		cluster.on('exit', (worker, code, signal) => {
			const reason = code === null ? signal : code;
			console.error(`worker ${worker.process.pid} exit (${reason})`);
		});
	} else {
		console.error('Listening for incoming LSP connections on', lspPort);
		var server = net.createServer((socket) => {
			const connection = newConnection(socket, socket);
			registerLanguageHandler(connection, strict, newLangHandler());
			connection.listen();
		});

		server.listen(lspPort);
	}
}
