import * as cluster from 'cluster';
import * as net from 'net';
import { IConnection } from 'vscode-languageserver';
import { newConnection, registerLanguageHandler, TraceOptions } from './connection';
import { LanguageHandler } from './lang-handler';
import { PrefixedLogger, StdioLogger } from './logging';

export interface ServeOptions extends TraceOptions {
	clusterSize: number;
	lspPort: number;
}

/**
 * serve starts a singleton language server instance that uses a
 * cluster of worker processes to achieve some semblance of
 * parallelism.
 */
export async function serve(options: ServeOptions, createLangHandler: (connection: IConnection) => LanguageHandler): Promise<void> {
	const logger = new PrefixedLogger(new StdioLogger(), cluster.isMaster ? 'master' : `wrkr ${cluster.worker.id}`);
	if (options.clusterSize > 1 && cluster.isMaster) {
		logger.log(`Spawning ${options.clusterSize} workers`);
		cluster.on('online', worker => {
			logger.log(`Worker ${worker.id} (PID ${worker.process.pid}) online`);
		});
		cluster.on('exit', (worker, code, signal) => {
			logger.error(`Worker ${worker.id} (PID ${worker.process.pid}) exited from signal ${signal} with code ${code}, restarting`);
			cluster.fork();
		});
		for (let i = 0; i < options.clusterSize; ++i) {
			cluster.fork();
		}
	} else {
		logger.info(`Listening for incoming LSP connections on ${options.lspPort}`);
		let counter = 1;
		let server = net.createServer(socket => {
			const id = counter++;
			logger.log(`Connection ${id} accepted`);
			// This connection listens on the socket
			const connection = newConnection(socket, socket, options);

			// Override the default exit notification handler so the process is not killed
			connection.onNotification('exit', () => {
				socket.end();
				socket.destroy();
				logger.log(`Connection ${id} closed (exit notification)`);
			});

			registerLanguageHandler(connection, createLangHandler(connection));

			connection.listen();
		});

		server.listen(options.lspPort);
	}
}
