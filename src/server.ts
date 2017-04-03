import * as cluster from 'cluster';
import * as net from 'net';
import { IConnection } from 'vscode-languageserver';
import { newConnection, registerLanguageHandler, TraceOptions } from './connection';
import { LanguageHandler } from './lang-handler';
import { Logger, PrefixedLogger, StdioLogger } from './logging';

export interface ServeOptions extends TraceOptions {
	clusterSize: number;
	lspPort: number;
}

/**
 * Creates a Logger prefixed with master or worker ID
 *
 * @param logger An optional logger to wrap, e.g. to write to a logfile. Defaults to STDIO
 */
export function createClusterLogger(logger = new StdioLogger()): Logger {
	return new PrefixedLogger(logger, cluster.isMaster ? 'master' : `wrkr ${cluster.worker.id}`);
}

/**
 * Starts up a cluster of worker processes that listen on the same TCP socket.
 * Crashing workers are restarted automatically.
 *
 * @param options
 * @param createLangHandler Factory function that is called for each new connection
 */
export async function serve(options: ServeOptions, createLangHandler: (connection: IConnection) => LanguageHandler): Promise<void> {
	const logger = options.logger || createClusterLogger();
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
			const connection = newConnection(socket as NodeJS.ReadableStream, socket, options);

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
