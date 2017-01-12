import * as net from 'net';
import * as cluster from 'cluster';

import { newConnection, registerLanguageHandler, TraceOptions } from './connection';
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

export interface ServeOptions extends TraceOptions {
	clusterSize: number;
	lspPort: number;
	strict?: boolean;
	trace?: boolean;
	logfile?: string;
}

/**
 * serve starts a singleton language server instance that uses a
 * cluster of worker processes to achieve some semblance of
 * parallelism.
 */
export async function serve(options: ServeOptions, newLangHandler: () => LanguageHandler): Promise<void> {
	rewriteConsole();

	if (cluster.isMaster) {
		console.error(`Master node process spawning ${options.clusterSize} workers`)
		for (let i = 0; i < options.clusterSize; ++i) {
			const worker = cluster.fork().on('disconnect', () => {
				console.error(`worker ${worker.process.pid} disconnect`)
			});
		}

		cluster.on('exit', (worker, code, signal) => {
			const reason = code === null ? signal : code;
			console.error(`worker ${worker.process.pid} exit (${reason})`);
		});
	} else {
		console.error('Listening for incoming LSP connections on', options.lspPort);
		var server = net.createServer((socket) => {
			const connection = newConnection(socket, socket, options);
			registerLanguageHandler(connection, options.strict, newLangHandler());
			connection.listen();
		});

		server.listen(options.lspPort);
	}
}
