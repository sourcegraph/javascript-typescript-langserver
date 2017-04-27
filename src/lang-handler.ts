import { Observable } from '@reactivex/rxjs';
import { FORMAT_TEXT_MAP, Span } from 'opentracing';
import { inspect } from 'util';
import { isReponseMessage, Message, NotificationMessage, RequestMessage, ResponseMessage } from 'vscode-jsonrpc/lib/messages';
import {
	ApplyWorkspaceEditParams,
	ApplyWorkspaceEditResponse,
	LogMessageParams,
	PublishDiagnosticsParams,
	TextDocumentIdentifier,
	TextDocumentItem
} from 'vscode-languageserver';
import { HasMeta } from './connection';
import { MessageEmitter, MessageWriter } from './connection';
import {
	CacheGetParams,
	CacheSetParams,
	TextDocumentContentParams,
	WorkspaceFilesParams
} from './request-type';

export interface LanguageClient {
	/**
	 * The content request is sent from the server to the client to request the current content of
	 * any text document. This allows language servers to operate without accessing the file system
	 * directly.
	 */
	textDocumentXcontent(params: TextDocumentContentParams, childOf?: Span): Promise<TextDocumentItem>;

	/**
	 * The files request is sent from the server to the client to request a list of all files in the
	 * workspace or inside the directory of the `base` parameter, if given.
	 */
	workspaceXfiles(params: WorkspaceFilesParams, childOf?: Span): Promise<TextDocumentIdentifier[]>;

	/**
	 * The log message notification is sent from the server to the client to ask
	 * the client to log a particular message.
	 */
	windowLogMessage(params: LogMessageParams): void;

	/**
	 * The cache get request is sent from the server to the client to request the value of a cache
	 * item identified by the provided key.
	 */
	xcacheGet(params: CacheGetParams, childOf?: Span): Promise<any>;

	/**
	 * The cache set notification is sent from the server to the client to set the value of a cache
	 * item identified by the provided key. This is a intentionally notification and not a request
	 * because the server is not supposed to act differently if the cache set failed.
	 */
	xcacheSet(params: CacheSetParams): void;

	/**
	 * Diagnostics are sent from the server to the client to notify the user of errors/warnings
	 * in a source file
	 * @param params The diagnostics to send to the client
	 */
	textDocumentPublishDiagnostics(params: PublishDiagnosticsParams): void;

	/**
	 * Requests a set of text changes to be applied to documents in the workspace
	 * Can occur as as a result of rename or executeCommand (code action).
	 * @param params The edits to apply to the workspace
	 */
	workspaceApplyEdit(params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResponse>;
}

/**
 * Provides an interface to call methods on the remote client.
 * Methods are named after the camelCase version of the LSP method name
 */
export class RemoteLanguageClient {

	/** The next request ID to use */
	private idCounter = 1;

	/**
	 * @param input MessageEmitter to listen on for responses
	 * @param output MessageWriter to write requests/notifications to
	 */
	constructor(private input: MessageEmitter, private output: MessageWriter) {}

	/**
	 * Sends a Request
	 *
	 * @param method The method to call
	 * @param params The params to pass to the method
	 * @return Emits the value of the result field or the error
	 */
	private request(method: string, params: any[] | { [attr: string]: any }, childOf = new Span()): Observable<any> {
		const tracer = childOf.tracer();
		const span = tracer.startSpan(`Request ${method}`, { childOf });
		span.setTag('params', inspect(params));
		return new Observable<any>(subscriber => {
			// Generate a request ID
			const id = this.idCounter++;
			const message: RequestMessage & HasMeta = { jsonrpc: '2.0', method, id, params, meta: {} };
			tracer.inject(span, FORMAT_TEXT_MAP, message.meta);
			// Send request
			this.output.write(message);
			let receivedResponse = false;
			// Subscribe to message events
			const messageSub = Observable.fromEvent<Message>(this.input, 'message')
				// Find response message with the correct ID
				.filter(msg => isReponseMessage(msg) && msg.id === id)
				.take(1)
				// Emit result or error
				.map((msg: ResponseMessage): any => {
					receivedResponse = true;
					if (msg.error) {
						throw Object.assign(new Error(msg.error.message), msg.error);
					}
					return msg.result;
				})
				// Forward events to subscriber
				.subscribe(subscriber);
			// Handler for unsubscribe()
			return () => {
				// Unsubscribe message event subscription (removes listener)
				messageSub.unsubscribe();
				if (!receivedResponse) {
					// Send LSP $/cancelRequest to client
					this.notify('$/cancelRequest', { id });
				}
			};
		}).catch(err => {
			span.setTag('error', true);
			span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
			throw err;
		}).finally(() => {
			span.finish();
		});
	}

	/**
	 * Sends a Notification
	 *
	 * @param method The method to notify
	 * @param params The params to pass to the method
	 */
	private notify(method: string, params: any[] | { [attr: string]: any }): void {
		const message: NotificationMessage = { jsonrpc: '2.0', method, params };
		this.output.write(message);
	}

	/**
	 * The content request is sent from the server to the client to request the current content of
	 * any text document. This allows language servers to operate without accessing the file system
	 * directly.
	 */
	textDocumentXcontent(params: TextDocumentContentParams, childOf = new Span()): Promise<TextDocumentItem> {
		return this.request('textDocument/xcontent', params, childOf).toPromise();
	}

	/**
	 * The files request is sent from the server to the client to request a list of all files in the
	 * workspace or inside the directory of the `base` parameter, if given.
	 */
	workspaceXfiles(params: WorkspaceFilesParams, childOf = new Span()): Promise<TextDocumentIdentifier[]> {
		return this.request('workspace/xfiles', params, childOf).toPromise();
	}

	/**
	 * The log message notification is sent from the server to the client to ask
	 * the client to log a particular message.
	 */
	windowLogMessage(params: LogMessageParams): void {
		this.notify('window/logMessage', params);
	}

	/**
	 * The cache get request is sent from the server to the client to request the value of a cache
	 * item identified by the provided key.
	 */
	xcacheGet(params: CacheGetParams, childOf = new Span()): Promise<any> {
		return this.request('xcache/get', params, childOf).toPromise();
	}

	/**
	 * The cache set notification is sent from the server to the client to set the value of a cache
	 * item identified by the provided key. This is a intentionally notification and not a request
	 * because the server is not supposed to act differently if the cache set failed.
	 */
	xcacheSet(params: CacheSetParams): void {
		return this.notify('xcache/set', params);
	}

	/**
	 * Diagnostics are sent from the server to the client to notify the user of errors/warnings
	 * in a source file
	 * @param params The diagnostics to send to the client
	 */
	textDocumentPublishDiagnostics(params: PublishDiagnosticsParams): void {
		this.notify('textDocument/publishDiagnostics', params);
	}

	/**
	 * Requests a set of text changes to be applied to documents in the workspace
	 * Can occur as as a result of rename or executeCommand (code action).
	 * @param params The edits to apply to the workspace
	 */
	workspaceApplyEdit(params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResponse> {
		return this.request('workspace/applyEdit', params).toPromise();
	}
}
