import { Observable } from '@reactivex/rxjs';
import { MessageWriter } from 'vscode-jsonrpc';
import { isReponseMessage, Message, NotificationMessage, RequestMessage, ResponseMessage } from 'vscode-jsonrpc/lib/messages';
import {
	LogMessageParams,
	TextDocumentIdentifier,
	TextDocumentItem
} from 'vscode-languageserver';
import { MessageEmitter } from './connection';
import { Logger, NoopLogger } from './logging';
import {
	TextDocumentContentParams,
	WorkspaceFilesParams
} from './request-type';

/**
 * Provides an interface to call methods on the remote client.
 * Methods are named after the camelCase version of the LSP method name
 */
export class RemoteLanguageClient {

	/**
	 * The next request ID to use
	 */
	private idCounter = 1;

	/**
	 * @param input MessageEmitter to listen on for responses
	 * @param output MessageWriter to write requests/notifications to
	 * @param logger Logger all outgoing messages will be logged to (if set)
	 */
	constructor(private input: MessageEmitter, private output: MessageWriter, private logger: Logger = new NoopLogger()) {}

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
			this.logger.log('<--', message);
			// Send request
			this.output.write(message);
			// Subscribe to message events
			const messageSub = Observable.fromEvent<Message>(this.input, 'message')
				// Find response message with the correct ID
				.filter(msg => isReponseMessage(msg) && msg.id === id)
				.take(1)
				// Emit result or error
				.map((msg: ResponseMessage): any => {
					if (msg.error) {
						throw Object.assign(new Error(msg.error.message), msg.error);
					}
					return msg.result;
				})
				// Forward events to subscriber
				.subscribe(subscriber);
			// Handler for unsubscribe()
			return () => {
				// Unsubscribe message event subscription
				messageSub.unsubscribe();
				// Send LSP $/cancelRequest to client
				this.notify('$/cancelRequest', { id });
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
		this.logger.log('<--', message);
		this.output.write(message);
	}

	/**
	 * The content request is sent from a server to a client to request the
	 * current content of a text document identified by the URI
	 */
	textDocumentContent(params: TextDocumentContentParams): Promise<TextDocumentItem> {
		return this.request('textDocument/xcontent', params).toPromise();
	}

	/**
	 * Returns a list of all files in a directory
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
}
