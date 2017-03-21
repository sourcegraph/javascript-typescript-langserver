import { DataCallback, Message, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc';
import { createConnection, IConnection } from 'vscode-languageserver';
import { LanguageHandler } from './lang-handler';
import { Logger, NoopLogger } from './logging';

export interface TraceOptions {
	logger?: Logger;
	trace?: boolean;
}

export function newConnection(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, options: TraceOptions): IConnection {

	const logger = options.logger || new NoopLogger();

	const reader = new StreamMessageReader(input);
	const listen = reader.listen.bind(reader);
	reader.listen = (callback: DataCallback) => {
		listen((message: Message): void => {
			if (options.trace) {
				logger.log('-->', message);
			}
			callback(message);
		});
	};

	const writer = new StreamMessageWriter(output);
	const write = writer.write.bind(writer);
	writer.write = (message: Message) => {
		if (options.trace) {
			logger.log('<--', message);
		}
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
	connection.onSignatureHelp((params, token) => handler.getSignatureHelp(params));

	// workspace
	connection.onWorkspaceSymbol((params, token) => handler.getWorkspaceSymbols(params, token));
	connection.onRequest('workspace/xreferences', (params, token) => handler.getWorkspaceReference(params, token));
	connection.onRequest('workspace/xpackages', (params, token) => handler.getPackages(params, token));
	connection.onRequest('workspace/xdependencies', (params, token) => handler.getDependencies(params, token));
}
