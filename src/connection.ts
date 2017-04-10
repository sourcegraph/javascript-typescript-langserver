import { Observable, Subscription } from '@reactivex/rxjs';
import { EventEmitter } from 'events';
import { camelCase, omit } from 'lodash';
import { FORMAT_TEXT_MAP, Span, Tracer } from 'opentracing';
import { inspect } from 'util';
import { ErrorCodes, Message, StreamMessageReader as VSCodeStreamMessageReader, StreamMessageWriter as VSCodeStreamMessageWriter } from 'vscode-jsonrpc';
import { isNotificationMessage, isReponseMessage, isRequestMessage, NotificationMessage, RequestMessage, ResponseMessage } from 'vscode-jsonrpc/lib/messages';
import { Logger, NoopLogger } from './logging';
import { TypeScriptService } from './typescript-service';

/**
 * Interface for JSON RPC messages with tracing metadata
 */
interface HasMeta {
	meta: { [key: string]: any };
}

/**
 * Returns true if the passed argument has a meta field
 */
function hasMeta(candidate: any): candidate is HasMeta {
	return typeof candidate === 'object' && candidate !== null && typeof candidate.meta === 'object' && candidate.meta !== null;
}

/**
 * Returns true if the passed argument is an object with a `.then()` method
 */
function isPromiseLike(candidate: any): candidate is PromiseLike<any> {
	return typeof candidate === 'object' && candidate !== null && typeof candidate.then === 'function';
}

export interface MessageLogOptions {
	/** Logger to use */
	logger?: Logger;

	/** Whether to log all messages */
	logMessages?: boolean;
}

/**
 * Takes a NodeJS ReadableStream and emits parsed messages received on the stream.
 * In opposite to StreamMessageReader, supports multiple listeners and is compatible with Observables
 */
export class MessageEmitter extends EventEmitter {

	constructor(input: NodeJS.ReadableStream, options: MessageLogOptions = {}) {
		super();
		const reader = new VSCodeStreamMessageReader(input);
		// Forward events
		reader.listen(msg => {
			this.emit('message', msg);
		});
		reader.onError(err => {
			this.emit('error', err);
		});
		reader.onClose(() => {
			this.emit('close');
		});
		this.setMaxListeners(Infinity);
		// Register message listener to log messages if configured
		if (options.logMessages && options.logger) {
			const logger = options.logger;
			this.on('message', message => {
				logger.log('-->', message);
			});
		}
	}

	/** Emitted when a new JSON RPC message was received on the input stream */
	on(event: 'message', listener: (message: Message) => void): this;
	/** Emitted when the underlying input stream emitted an error */
	on(event: 'error', listener: (error: Error) => void): this;
	/** Emitted when the underlying input stream was closed */
	on(event: 'close', listener: () => void): this;
	/* istanbul ignore next */
	on(event: string, listener: () => void): this {
		return super.on(event, listener);
	}

	/** Emitted when a new JSON RPC message was received on the input stream */
	once(event: 'message', listener: (message: Message) => void): this;
	/** Emitted when the underlying input stream emitted an error */
	once(event: 'error', listener: (error: Error) => void): this;
	/** Emitted when the underlying input stream was closed */
	once(event: 'close', listener: () => void): this;
	/* istanbul ignore next */
	once(event: string, listener: () => void): this {
		return super.on(event, listener);
	}
}

/**
 * Wraps vscode-jsonrpcs StreamMessageWriter to support logging messages,
 * decouple our code from the vscode-jsonrpc module and provide a more
 * consistent event API
 */
export class MessageWriter {

	private logger: Logger;
	private logMessages: boolean;
	private vscodeWriter: VSCodeStreamMessageWriter;

	/**
	 * @param output The output stream to write to (e.g. STDOUT or a socket)
	 * @param options
	 */
	constructor(output: NodeJS.WritableStream, options: MessageLogOptions = {}) {
		this.vscodeWriter = new VSCodeStreamMessageWriter(output);
		this.logger = options.logger || new NoopLogger();
		this.logMessages = !!options.logMessages;
	}

	/**
	 * Writes a JSON RPC message to the output stream.
	 * Logs it if configured
	 *
	 * @param message A complete JSON RPC message object
	 */
	write(message: RequestMessage | NotificationMessage | ResponseMessage): void {
		if (this.logMessages) {
			this.logger.log('<--', message);
		}
		this.vscodeWriter.write(message);
	}
}

export interface RegisterLanguageHandlerOptions {

	logger?: Logger;

 	/** An opentracing-compatible tracer */
	tracer?: Tracer;
}

/**
 * Registers all method implementations of a LanguageHandler on a connection
 *
 * @param messageEmitter MessageEmitter to listen on
 * @param messageWriter MessageWriter to write to
 * @param handler TypeScriptService object that contains methods for all methods to be handled
 */
export function registerLanguageHandler(messageEmitter: MessageEmitter, messageWriter: MessageWriter, handler: TypeScriptService, options: RegisterLanguageHandlerOptions = {}): void {

	const logger = options.logger || new NoopLogger();
	const tracer = options.tracer || new Tracer();

	/** Tracks Subscriptions for results to unsubscribe them on $/cancelRequest */
	const subscriptions = new Map<string | number, Subscription>();

	/**
	 * Whether the handler is in an initialized state.
	 * `initialize` sets this to true, `shutdown` to false.
	 * Used to determine whether a manual `shutdown` call is needed on error/close
	 */
	let initialized = false;

	messageEmitter.on('message', async message => {
		// Ignore responses
		if (isReponseMessage(message)) {
			return;
		}
		if (!isRequestMessage(message) && !isNotificationMessage(message)) {
			logger.error('Received invalid message:', message);
			return;
		}
		switch (message.method) {
			case 'initialize':
				initialized = true;
				break;
			case 'shutdown':
				initialized = false;
				break;
			case 'exit':
				// Ignore exit notification, it's not the responsibility of the TypeScriptService to handle it,
				// but the TCP / STDIO server which needs to close the socket or kill the process
				return;
			case '$/cancelRequest':
				// Cancel another request by unsubscribing from the Observable
				const subscription = subscriptions.get(message.params.id);
				if (!subscription) {
					logger.error(`$/cancelRequest for unknown request ID ${message.params.id}`);
					return;
				}
				subscription.unsubscribe();
				subscriptions.delete(message.params.id);
				messageWriter.write({
					jsonrpc: '2.0',
					id: message.params.id,
					error: {
						message: 'Request cancelled',
						code: ErrorCodes.RequestCancelled
					}
				});
				return;
		}
		const method = camelCase(message.method);
		let span = new Span();
		if (isRequestMessage(message)) {
			// If message is request and has tracing metadata, extract the span context and create a span for the method call
			if (hasMeta(message)) {
				const context = tracer.extract(FORMAT_TEXT_MAP, message.meta);
				if (context) {
					span = tracer.startSpan('Handle ' + message.method, { childOf: context });
					span.setTag('params', inspect(message.params));
				}
			}
			if (typeof (handler as any)[method] !== 'function') {
				// Method not implemented
				messageWriter.write({
					jsonrpc: '2.0',
					id: message.id,
					error: {
						code: ErrorCodes.MethodNotFound,
						message: `Method ${method} not implemented`
					}
				});
				return;
			}
		}
		// Call handler method with params and span
		const returnValue = (handler as any)[method](message.params, span);
		// Convert return value to Observable that emits a single item, the result (or an error)
		let observable: Observable<any>;
		if (returnValue instanceof Observable) {
			observable = returnValue.take(1);
		} else if (isPromiseLike(returnValue)) {
			// Convert Promise to Observable
			observable = Observable.from(returnValue);
		} else {
			// Convert synchronous value to Observable
			observable = Observable.of(returnValue);
		}
		if (isRequestMessage(message)) {
			// If request, subscribe to result and send a response
			const subscription = observable
				.finally(() => {
					// Finish span
					span.finish();
					// Delete subscription from Map
					// Make sure to not run this before subscription.set() was called
					// (in case the Observable is synchronous)
					process.nextTick(() => {
						subscriptions.delete(message.id);
					});
				})
				.subscribe(result => {
					// Send result
					messageWriter.write({
						jsonrpc: '2.0',
						id: message.id,
						result
					});
				}, err => {
					// Send error response
					messageWriter.write({
						jsonrpc: '2.0',
						id: message.id,
						error: {
							message: err.message + '',
							code: typeof err.code === 'number' ? err.code : ErrorCodes.UnknownErrorCode,
							data: omit(err, ['message', 'code'])
						}
					});
					// Set error on span
					span.setTag('error', true);
					span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
					// Log error
					logger.error(`Handler for ${message.method} failed:`, err, 'Message:', message);
				});
			// Save subscription for $/cancelRequest
			subscriptions.set(message.id, subscription);
		} else {
			// For notifications, still subscribe and log potential error
			observable.subscribe(undefined, err => {
				logger.error(`Handle ${method}:`, err);
			});
		}
	});

	// On stream close, shutdown handler if it was initialized
	messageEmitter.once('close', () => {
		if (initialized) {
			initialized = false;
			logger.error('Stream was closed without shutdown notification');
			handler.shutdown();
		}
	});

	// On stream error, shutdown handler if it was initialized
	messageEmitter.once('error', err => {
		if (initialized) {
			initialized = false;
			logger.error('Stream:', err);
			handler.shutdown();
		}
	});
}
