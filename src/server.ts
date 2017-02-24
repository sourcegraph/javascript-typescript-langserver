import * as net from 'net';
import * as cluster from 'cluster';

import { newConnection, registerLanguageHandler, TraceOptions } from './connection';
import { registerMasterHandler } from './master-connection';
import { LanguageHandler } from './lang-handler';
import { IConnection } from 'vscode-languageserver';
import { ExitRequest } from './request-type';

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
 *
 * @param createWorkerConnection Should return a connection to a subworker (for example by spawning a child process)
 */
export async function serve(options: ServeOptions, createLangHandler: () => LanguageHandler, createWorkerConnection?: () => IConnection): Promise<void> {
	rewriteConsole();

	if (cluster.isMaster) {
		console.error(`Master node process spawning ${options.clusterSize} workers`);
		cluster.on('online', worker => {
			console.error(`Worker ${worker.id} online`);
		});
		cluster.on('exit', (worker, code, signal) => {
			console.error(`Worker ${worker.id} exited from signal ${signal} with code ${code}, restarting`);
			cluster.fork();
		});
		for (let i = 0; i < options.clusterSize; ++i) {
			cluster.fork();
		}
	} else {
		console.error('Listening for incoming LSP connections on', options.lspPort);
		var server = net.createServer(socket => {
			// This connection listens on the socket
			const master = newConnection(socket, socket, options);

			// Override the default exit notification handler so the process is not killed
			master.onNotification(ExitRequest.type, () => {
				console.error('Closing socket');
				socket.end();
			});

			if (createWorkerConnection) {
				// Spawn two child processes that communicate through STDIN/STDOUT
				// One gets short-running requests like textDocument/definition,
				// the other long-running requests like textDocument/references
				// TODO: Don't spawn new processes on every connection, keep them warm
				//       Need to make sure exit notifications don't come through and LS supports re-initialization
				const leightWeightWorker = createWorkerConnection();
				const heavyDutyWorker = createWorkerConnection();

				registerMasterHandler(master, leightWeightWorker, heavyDutyWorker);

				leightWeightWorker.listen();
				heavyDutyWorker.listen();
			} else {
				registerLanguageHandler(master, options.strict, createLangHandler());
			}

			master.listen();
		});

		server.listen(options.lspPort);
	}
}
