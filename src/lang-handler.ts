import { Observable } from '@reactivex/rxjs';
import { isReponseMessage, Message, NotificationMessage, RequestMessage, ResponseMessage } from 'vscode-jsonrpc/lib/messages';
import {
	LogMessageParams,
	TextDocumentIdentifier,
	TextDocumentItem
} from 'vscode-languageserver';
import { MessageEmitter, MessageWriter } from './connection';
import {
	CacheGetParams,
	CacheSetParams,
	TextDocumentContentParams,
	WorkspaceFilesParams
} from './request-type';

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
	private request(method: string, params: any[] | { [attr: string]: any }): Observable<any> {
		return new Observable<any>(subscriber => {
			// Generate a request ID
			const id = this.idCounter++;
			const message: RequestMessage = { jsonrpc: '2.0', method, id, params };
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
	textDocumentXcontent(params: TextDocumentContentParams): Promise<TextDocumentItem> {
		return this.request('textDocument/xcontent', params).toPromise();
	}

	/**
	 * The files request is sent from the server to the client to request a list of all files in the
	 * workspace or inside the directory of the `base` parameter, if given.
	 */
	workspaceXfiles(params: WorkspaceFilesParams): Promise<TextDocumentIdentifier[]> {
		return this.request('workspace/xfiles', params).toPromise();
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
	xcacheGet(params: CacheGetParams): Promise<any> {
		return this.request('xcache/get', params).toPromise();
	}

	/**
	 * The cache set notification is sent from the server to the client to set the value of a cache
	 * item identified by the provided key. This is a intentionally notification and not a request
	 * because the server is not supposed to act differently if the cache set failed.
	 */
	xcacheSet(params: CacheSetParams): void {
		return this.notify('xcache/set', params);
	}
}
