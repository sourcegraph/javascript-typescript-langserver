import { Observable, Subscription } from '@reactivex/rxjs';
import { EventEmitter } from 'events';
import { camelCase, omit } from 'lodash';
import { FORMAT_TEXT_MAP, Span, Tracer } from 'opentracing';
import { inspect } from 'util';
import { ErrorCodes, Message, MessageWriter, StreamMessageReader } from 'vscode-jsonrpc';
import { isNotificationMessage, isRequestMessage, ResponseMessage } from 'vscode-jsonrpc/lib/messages';
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

/**
 * Takes a NodeJS ReadableStream and emits parsed messages received on the stream.
 * In opposite to StreamMessageReader, supports multiple listeners and is compatible with Observables
 */
export class MessageEmitter extends EventEmitter {

	constructor(input: NodeJS.ReadableStream) {
		super();
		const reader = new StreamMessageReader(input);
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
	}

	on(event: 'message', listener: (message: Message) => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
	on(event: 'close', listener: () => void): this;
	on(event: string, listener: Function): this {
		return super.on(event, listener);
	}
}

/**
 * Registers all method implementations of a LanguageHandler on a connection
 *
 * @param messageEmitter MessageEmitter to listen on
 * @param messageWriter MessageWriter to write to
 * @param handler TypeScriptService object that contains methods for all methods to be handled
 * @param logger A logger that all messages will be logged to
 * @param tracer An opentracing-compatible tracer
 */
export function registerLanguageHandler(
	messageEmitter: MessageEmitter,
	messageWriter: MessageWriter,
	handler: TypeScriptService,
	logger: Logger = new NoopLogger(),
	tracer = new Tracer()
): void {
	/** Tracks Subscriptions for results to unsubscribe them on $/cancelRequest */
	const subscriptions = new Map<string | number, Subscription>();
	messageEmitter.on('message', async message => {
		logger.log('-->', message);
		// Ignore responses
		if (!isRequestMessage(message) && !isNotificationMessage(message)) {
			return;
		}
		if (message.method === '$/cancelRequest' && isNotificationMessage(message)) {
			// Cancel another request by unsubscribing from the Observable
			const subscription = subscriptions.get(message.params.id);
			if (!subscription) {
				logger.error(`$/cancelRequest for unknown request ID ${message.params.id}`);
				return;
			}
			subscription.unsubscribe();
			subscriptions.delete(message.params.id);
			return;
		}
		// If message is request and has tracing metadata, extract the span context and create a span for the method call
		let span = new Span();
		if (hasMeta(message) && isRequestMessage(message)) {
			const context = tracer.extract(FORMAT_TEXT_MAP, message.meta);
			if (context) {
				span = tracer.startSpan('Handle ' + message.method, { childOf: context });
				span.setTag('params', inspect(message.params));
			}
		}
		const method = camelCase(message.method);
		if (isRequestMessage(message) && typeof (handler as any)[method] !== 'function') {
			// Method not implemented
			messageWriter.write({
				jsonrpc: '2.0',
				id: message.id,
				error: {
					code: ErrorCodes.MethodNotFound,
					message: `Method ${method} not implemented`
				}
			} as ResponseMessage);
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
					subscriptions.delete(message.id);
				})
				.subscribe(result => {
					// Send result
					messageWriter.write({
						jsonrpc: '2.0',
						id: message.id,
						result
					} as ResponseMessage);
				}, err => {
					// Send error response
					messageWriter.write({
						jsonrpc: '2.0',
						id: message.id,
						error: {
							message: err.message + '',
							code: typeof err.code === 'number' ? err.code : ErrorCodes.InternalError,
							data: omit(err, ['message', 'code'])
						}
					} as ResponseMessage);
					// Set error on span
					span.setTag('error', true);
					span.log({ 'event': 'error', 'error.object': err });
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
}
