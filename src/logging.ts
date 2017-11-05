import chalk from 'chalk'
import * as fs from 'fs'
import { inspect } from 'util'
import { MessageType } from 'vscode-languageserver'
import { LanguageClient } from './lang-handler'

export interface Logger {
    log(...values: any[]): void
    info(...values: any[]): void
    warn(...values: any[]): void
    error(...values: any[]): void
}

/**
 * Formats values to a message by pretty-printing objects
 */
function format(values: any[]): string {
    return values.map(value => (typeof value === 'string' ? value : inspect(value, { depth: Infinity }))).join(' ')
}

/**
 * A logger implementation that sends window/logMessage notifications to an LSP client
 */
export class LSPLogger implements Logger {
    /**
     * @param client The client to send window/logMessage notifications to
     */
    constructor(private client: LanguageClient) {}

    public log(...values: any[]): void {
        try {
            this.client.windowLogMessage({ type: MessageType.Log, message: format(values) })
        } catch (err) {
            // ignore
        }
    }

    public info(...values: any[]): void {
        try {
            this.client.windowLogMessage({ type: MessageType.Info, message: format(values) })
        } catch (err) {
            // ignore
        }
    }

    public warn(...values: any[]): void {
        try {
            this.client.windowLogMessage({ type: MessageType.Warning, message: format(values) })
        } catch (err) {
            // ignore
        }
    }

    public error(...values: any[]): void {
        try {
            this.client.windowLogMessage({ type: MessageType.Error, message: format(values) })
        } catch (err) {
            // ignore
        }
    }
}

/**
 * Logging implementation that writes to an arbitrary NodeJS stream
 */
export class StreamLogger {
    constructor(private outStream: NodeJS.WritableStream, private errStream: NodeJS.WritableStream) {}
    public log(...values: any[]): void {
        try {
            this.outStream.write(chalk.grey('DEBUG ' + format(values) + '\n'))
        } catch (err) {
            // ignore
        }
    }

    public info(...values: any[]): void {
        try {
            this.outStream.write(chalk.bgCyan('INFO') + '  ' + format(values) + '\n')
        } catch (err) {
            // ignore
        }
    }

    public warn(...values: any[]): void {
        try {
            this.errStream.write(chalk.bgYellow('WARN') + '  ' + format(values) + '\n')
        } catch (err) {
            // ignore
        }
    }

    public error(...values: any[]): void {
        try {
            this.errStream.write(chalk.bgRed('ERROR') + ' ' + format(values) + '\n')
        } catch (err) {
            // ignore
        }
    }
}

/**
 * Logger implementation that logs to STDOUT and STDERR depending on level
 */
export class StdioLogger extends StreamLogger {
    constructor() {
        super(process.stdout, process.stderr)
    }
}

/**
 * Logger implementation that logs only to STDERR
 */
export class StderrLogger extends StreamLogger {
    constructor() {
        super(process.stderr, process.stderr)
    }
}

/**
 * Logger implementation that logs to a file
 */
export class FileLogger extends StreamLogger {
    /**
     * @param file Path to the logfile
     */
    constructor(file: string) {
        const stream = fs.createWriteStream(file)
        super(stream, stream)
    }
}

/**
 * Logger implementation that wraps another logger and prefixes every message with a given prefix
 */
export class PrefixedLogger {
    constructor(private logger: Logger, private prefix: string) {}

    public log(...values: any[]): void {
        this.logger.log(`[${this.prefix}] ${format(values)}`)
    }

    public info(...values: any[]): void {
        this.logger.info(`[${this.prefix}] ${format(values)}`)
    }

    public warn(...values: any[]): void {
        this.logger.warn(`[${this.prefix}] ${format(values)}`)
    }

    public error(...values: any[]): void {
        this.logger.error(`[${this.prefix}] ${format(values)}`)
    }
}

/**
 * Logger implementation that does nothing
 */
export class NoopLogger {
    public log(...values: any[]): void {
        // empty
    }

    public info(...values: any[]): void {
        // empty
    }

    public warn(...values: any[]): void {
        // empty
    }

    public error(...values: any[]): void {
        // empty
    }
}
