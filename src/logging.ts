
import * as chalk from 'chalk';
import * as fs from 'fs';
import { inspect } from 'util';
import { MessageType } from 'vscode-languageserver';
import { RemoteLanguageClient } from './lang-handler';

export interface Logger {
	log(...values: any[]): void;
	info(...values: any[]): void;
	warn(...values: any[]): void;
	error(...values: any[]): void;
}

/**
 * Formats values to a message by pretty-printing objects
 */
function format(values: any[]): string {
	return values.map(value => typeof value === 'string' ? value : inspect(value, {depth: Infinity})).join(' ');
}

/**
 * A logger implementation that sends window/logMessage notifications to an LSP client
 */
export class LSPLogger implements Logger {

	/**
	 * @param client The client to send window/logMessage notifications to
	 */
	constructor(private client: RemoteLanguageClient) {}

	log(...values: any[]): void {
		try {
			this.client.windowLogMessage({ type: MessageType.Log, message: format(values) });
		} catch (err) {
			// ignore
		}
	}

	info(...values: any[]): void {
		try {
			this.client.windowLogMessage({ type: MessageType.Info, message: format(values) });
		} catch (err) {
			// ignore
		}
	}

	warn(...values: any[]): void {
		try {
			this.client.windowLogMessage({ type: MessageType.Warning, message: format(values) });
		} catch (err) {
			// ignore
		}
	}

	error(...values: any[]): void {
		try {
			this.client.windowLogMessage({ type: MessageType.Error, message: format(values) });
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
	log(...values: any[]): void {
		try {
			this.outStream.write(chalk.grey('DEBUG ' + format(values) + '\n'));
		} catch (err) {
			// ignore
		}
	}

	info(...values: any[]): void {
		try {
			this.outStream.write(chalk.bgCyan('INFO') + '  ' + format(values) + '\n');
		} catch (err) {
			// ignore
		}
	}

	warn(...values: any[]): void {
		try {
			this.errStream.write(chalk.bgYellow('WARN') + '  ' + format(values) + '\n');
		} catch (err) {
			// ignore
		}
	}

	error(...values: any[]): void {
		try {
			this.errStream.write(chalk.bgRed('ERROR') + ' ' + format(values) + '\n');
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
		super(process.stdout, process.stderr);
	}
}

/**
 * Logger implementation that logs only to STDERR
 */
export class StderrLogger extends StreamLogger {
	constructor() {
		super(process.stderr, process.stderr);
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
		const stream = fs.createWriteStream(file);
		super(stream, stream);
	}
}

/**
 * Logger implementation that wraps another logger and prefixes every message with a given prefix
 */
export class PrefixedLogger {

	constructor(private logger: Logger, private prefix: string) {}

	log(...values: any[]): void {
		this.logger.log(`[${this.prefix}] ${format(values)}`);
	}

	info(...values: any[]): void {
		this.logger.info(`[${this.prefix}] ${format(values)}`);
	}

	warn(...values: any[]): void {
		this.logger.warn(`[${this.prefix}] ${format(values)}`);
	}

	error(...values: any[]): void {
		this.logger.error(`[${this.prefix}] ${format(values)}`);
	}
}

/**
 * Logger implementation that does nothing
 */
export class NoopLogger {
	log(...values: any[]): void {
		// empty
	}

	info(...values: any[]): void {
		// empty
	}

	warn(...values: any[]): void {
		// empty
	}

	error(...values: any[]): void {
		// empty
	}
}
