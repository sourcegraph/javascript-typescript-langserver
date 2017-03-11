import * as fs_ from 'fs';
import { EOL } from 'os';
import * as util from 'util';
import { DataCallback, Message, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc';
import { createConnection, IConnection } from 'vscode-languageserver';
import { LanguageHandler } from './lang-handler';

/**
 * Tracing options control dumping request/responses to stderr and optional file
 */
export interface TraceOptions {
	trace?: boolean;
	logfile?: string;
}

export function newConnection(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, trace: TraceOptions): IConnection {

	const reader = new StreamMessageReader(input);

	let logger: fs_.WriteStream = null;
	if (trace.trace && trace.logfile) {
		try {
			logger = fs_.createWriteStream(trace.logfile, { flags: 'a', encoding: 'utf-8' });
		} catch (e) {
			console.error('Unable to initialize logger', e);
		}
	}

	const listen = reader.listen.bind(reader);
	reader.listen = (callback: DataCallback) => {
		const tracer = (message: Message): void => {
			doTrace(message, trace, logger, '-->');
			callback(message);
		};
		listen(tracer);
	};

	const writer = new StreamMessageWriter(output);
	const write = writer.write.bind(writer);
	writer.write = (message: Message) => {
		doTrace(message, trace, logger, '<--');
		write(message);
	};

	const connection = createConnection(reader, writer);

	// Remove vscode-languageserver's stream listeners that kill the process if the stream is closed
	input.removeAllListeners('end');
	input.removeAllListeners('close');
	output.removeAllListeners('end');
	output.removeAllListeners('close');

	return connection;
}

/**
 * Registers all method implementations of a LanguageHandler on a connection
 */
export function registerLanguageHandler(connection: IConnection, handler: LanguageHandler): void {

	connection.onInitialize((params, token) => handler.initialize(params, token));
	connection.onShutdown(() => handler.shutdown());

	// textDocument
	connection.onDidOpenTextDocument(params => handler.didOpen(params));
	connection.onDidChangeTextDocument(params => handler.didChange(params));
	connection.onDidSaveTextDocument(params => handler.didSave(params));
	connection.onDidCloseTextDocument(params => handler.didClose(params));
	connection.onReferences((params, token) => handler.getReferences(params, token));
	connection.onHover((params, token) => handler.getHover(params, token));
	connection.onDefinition((params, token) => handler.getDefinition(params, token));
	connection.onDocumentSymbol((params, token) => handler.getDocumentSymbol(params, token));
	connection.onCompletion((params, token) => handler.getCompletions(params, token));
	connection.onRequest('textDocument/xdefinition', (params, token) => handler.getXdefinition(params, token));

	// workspace
	connection.onWorkspaceSymbol((params, token) => handler.getWorkspaceSymbols(params, token));
	connection.onRequest('workspace/xreferences', (params, token) => handler.getWorkspaceReference(params, token));
	connection.onRequest('workspace/xpackages', (params, token) => handler.getPackages(params, token));
	connection.onRequest('workspace/xdependencies', (params, token) => handler.getDependencies(params, token));
}

function dump(message: Message): string {
	return util.inspect(message);
}

function doTrace(message: Message, options: TraceOptions, stream: fs_.WriteStream, prefix: string) {
	if (options.trace) {
		const text = prefix + ' ' + dump(message);
		console.error(text);
		if (stream) {
			try {
				stream.write(text + EOL);
			} catch (e) {
				// ignore
			}
		}
	}

}
