import * as cluster from 'cluster';
import * as net from 'net';

import { newConnection, registerLanguageHandler, TraceOptions } from './connection';
import { LanguageHandler } from './lang-handler';

async function rewriteConsole() {
	const consoleErr = console.error;
	console.error = function error(this: typeof console) {
		if (cluster.isMaster) {
			consoleErr.call(this, `[mstr]`, ...arguments);
		} else {
			consoleErr.call(this, `[wkr${cluster.worker.id}]`, ...arguments);
		}
	};
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
export async function serve(options: ServeOptions, createLangHandler: () => LanguageHandler): Promise<void> {
	rewriteConsole();

	if (options.clusterSize > 1 && cluster.isMaster) {
		console.error(`Master (PID ${process.pid}) spawning ${options.clusterSize} workers`);
		cluster.on('online', worker => {
			console.error(`Worker ${worker.id} (PID ${worker.process.pid}) online`);
		});
		cluster.on('exit', (worker, code, signal) => {
			console.error(`Worker ${worker.id} (PID ${worker.process.pid}) exited from signal ${signal} with code ${code}, restarting`);
			cluster.fork();
		});
		for (let i = 0; i < options.clusterSize; ++i) {
			cluster.fork();
		}
	} else {
		console.error('Listening for incoming LSP connections on', options.lspPort);
		let server = net.createServer(socket => {
			console.error('Connection accepted');
			// This connection listens on the socket
			const connection = newConnection(socket, socket, options);

			// Override the default exit notification handler so the process is not killed
			connection.onNotification('exit', () => {
				console.error('Exit notification, closing socket');
				socket.end();
				socket.destroy();
			});

			registerLanguageHandler(connection, options.strict, createLangHandler());

			connection.listen();
		});

		server.listen(options.lspPort);
	}
}
