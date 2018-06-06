import * as cluster from 'cluster'
import * as net from 'net'
import { Tracer } from 'opentracing'
import { isNotificationMessage } from 'vscode-jsonrpc/lib/messages'
import { MessageEmitter, MessageLogOptions, MessageWriter, registerLanguageHandler } from './connection'
import { RemoteLanguageClient } from './lang-handler'
import { Logger, PrefixedLogger, StdioLogger } from './logging'
import { TypeScriptService } from './typescript-service'

/** Options to `serve()` */
export interface ServeOptions extends MessageLogOptions {
    /** Amount of workers to spawn */
    clusterSize: number

    /** Port to listen on for TCP LSP connections */
    lspPort: number

    /** An OpenTracing-compatible Tracer */
    tracer?: Tracer
}

/**
 * Creates a Logger prefixed with master or worker ID
 *
 * @param logger An optional logger to wrap, e.g. to write to a logfile. Defaults to STDIO
 */
export function createClusterLogger(logger = new StdioLogger()): Logger {
    return new PrefixedLogger(logger, cluster.isMaster ? 'master' : `wrkr ${cluster.worker.id}`)
}

/**
 * Starts up a cluster of worker processes that listen on the same TCP socket.
 * Crashing workers are restarted automatically.
 *
 * @param options
 * @param createLangHandler Factory function that is called for each new connection
 */
export function serve(
    options: ServeOptions,
    createLangHandler = (remoteClient: RemoteLanguageClient) => new TypeScriptService(remoteClient)
): void {
    const logger = options.logger || createClusterLogger()
    if (options.clusterSize > 1 && cluster.isMaster) {
        logger.log(`Spawning ${options.clusterSize} workers`)
        cluster.on('online', worker => {
            logger.log(`Worker ${worker.id} (PID ${worker.process.pid}) online`)
        })
        cluster.on('exit', (worker, code, signal) => {
            const baseLogMessage = `Worker ${worker.id} (PID ${
                worker.process.pid
            }) exited from signal ${signal} with code ${code}`

            if (!worker.exitedAfterDisconnect) {
                logger.error(`${baseLogMessage}, restarting`)
                cluster.fork()
                return
            }

            logger.info(`${baseLogMessage}, not restarting since exit was voluntary`)
        })
        for (let i = 0; i < options.clusterSize; ++i) {
            cluster.fork()
        }
    } else {
        let counter = 1
        const server = net.createServer(socket => {
            const id = counter++
            logger.log(`Connection ${id} accepted`)

            const messageEmitter = new MessageEmitter(socket as NodeJS.ReadableStream, options)
            const messageWriter = new MessageWriter(socket, options)
            const remoteClient = new RemoteLanguageClient(messageEmitter, messageWriter)

            // Add exit notification handler to close the socket on exit
            messageEmitter.on('message', message => {
                if (isNotificationMessage(message) && message.method === 'exit') {
                    socket.end()
                    socket.destroy()
                    logger.log(`Connection ${id} closed (exit notification)`)
                }
            })

            registerLanguageHandler(messageEmitter, messageWriter, createLangHandler(remoteClient), options)
        })

        server.listen(options.lspPort, () => {
            logger.info(`Listening for incoming LSP connections on ${options.lspPort}`)
        })
    }
}
