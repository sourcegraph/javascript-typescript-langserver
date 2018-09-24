import { FORMAT_TEXT_MAP, Span } from 'opentracing'
import { Observable } from 'rxjs'
import { inspect } from 'util'
import {
    isResponseMessage,
    Message,
    NotificationMessage,
    RequestMessage,
    ResponseMessage,
} from 'vscode-jsonrpc/lib/messages'
import {
    ApplyWorkspaceEditParams,
    ApplyWorkspaceEditResponse,
    LogMessageParams,
    PublishDiagnosticsParams,
    TextDocumentIdentifier,
    TextDocumentItem,
} from 'vscode-languageserver'
import { HasMeta } from './connection'
import { MessageEmitter, MessageWriter } from './connection'
import { CacheGetParams, CacheSetParams, TextDocumentContentParams, WorkspaceFilesParams } from './request-type'
import { traceObservable } from './tracing'

export interface LanguageClient {
    /**
     * The content request is sent from the server to the client to request the current content of
     * any text document. This allows language servers to operate without accessing the file system
     * directly.
     */
    textDocumentXcontent(params: TextDocumentContentParams, childOf?: Span): Observable<TextDocumentItem>

    /**
     * The files request is sent from the server to the client to request a list of all files in the
     * workspace or inside the directory of the `base` parameter, if given.
     */
    workspaceXfiles(params: WorkspaceFilesParams, childOf?: Span): Observable<TextDocumentIdentifier[]>

    /**
     * The log message notification is sent from the server to the client to ask
     * the client to log a particular message.
     */
    windowLogMessage(params: LogMessageParams): void

    /**
     * The cache get request is sent from the server to the client to request the value of a cache
     * item identified by the provided key.
     */
    xcacheGet(params: CacheGetParams, childOf?: Span): Observable<any>

    /**
     * The cache set notification is sent from the server to the client to set the value of a cache
     * item identified by the provided key. This is a intentionally notification and not a request
     * because the server is not supposed to act differently if the cache set failed.
     */
    xcacheSet(params: CacheSetParams): void

    /**
     * Diagnostics are sent from the server to the client to notify the user of errors/warnings
     * in a source file
     * @param params The diagnostics to send to the client
     */
    textDocumentPublishDiagnostics(params: PublishDiagnosticsParams): void

    /**
     * Requests a set of text changes to be applied to documents in the workspace
     * Can occur as as a result of rename or executeCommand (code action).
     * @param params The edits to apply to the workspace
     */
    workspaceApplyEdit(params: ApplyWorkspaceEditParams, childOf?: Span): Observable<ApplyWorkspaceEditResponse>
}

/**
 * Provides an interface to call methods on the remote client.
 * Methods are named after the camelCase version of the LSP method name
 */
export class RemoteLanguageClient {
    /** The next request ID to use */
    private idCounter = 1

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
        return traceObservable(`Request ${method}`, childOf, span => {
            span.setTag('params', inspect(params))
            return new Observable<any>(subscriber => {
                // Generate a request ID
                const id = this.idCounter++
                const message: RequestMessage & HasMeta = { jsonrpc: '2.0', method, id, params, meta: {} }
                childOf.tracer().inject(span, FORMAT_TEXT_MAP, message.meta)
                // Send request
                this.output.write(message)
                let receivedResponse = false
                // Subscribe to message events
                const messageSub = Observable.fromEvent<Message>(this.input, 'message')
                    // Find response message with the correct ID
                    .filter(msg => isResponseMessage(msg) && msg.id === id)
                    .take(1)
                    // Emit result or error
                    .map((msg: ResponseMessage): any => {
                        receivedResponse = true
                        if (msg.error) {
                            throw Object.assign(new Error(msg.error.message), msg.error)
                        }
                        return msg.result
                    })
                    // Forward events to subscriber
                    .subscribe(subscriber)
                // Handler for unsubscribe()
                return () => {
                    // Unsubscribe message event subscription (removes listener)
                    messageSub.unsubscribe()
                    if (!receivedResponse) {
                        // Send LSP $/cancelRequest to client
                        this.notify('$/cancelRequest', { id })
                    }
                }
            })
        })
    }

    /**
     * Sends a Notification
     *
     * @param method The method to notify
     * @param params The params to pass to the method
     */
    private notify(method: string, params: any[] | { [attr: string]: any }): void {
        const message: NotificationMessage = { jsonrpc: '2.0', method, params }
        this.output.write(message)
    }

    /**
     * The content request is sent from the server to the client to request the current content of
     * any text document. This allows language servers to operate without accessing the file system
     * directly.
     */
    public textDocumentXcontent(params: TextDocumentContentParams, childOf = new Span()): Observable<TextDocumentItem> {
        return this.request('textDocument/xcontent', params, childOf)
    }

    /**
     * The files request is sent from the server to the client to request a list of all files in the
     * workspace or inside the directory of the `base` parameter, if given.
     */
    public workspaceXfiles(params: WorkspaceFilesParams, childOf = new Span()): Observable<TextDocumentIdentifier[]> {
        return this.request('workspace/xfiles', params, childOf)
    }

    /**
     * The log message notification is sent from the server to the client to ask
     * the client to log a particular message.
     */
    public windowLogMessage(params: LogMessageParams): void {
        this.notify('window/logMessage', params)
    }

    /**
     * The cache get request is sent from the server to the client to request the value of a cache
     * item identified by the provided key.
     */
    public xcacheGet(params: CacheGetParams, childOf = new Span()): Observable<any> {
        return this.request('xcache/get', params, childOf)
    }

    /**
     * The cache set notification is sent from the server to the client to set the value of a cache
     * item identified by the provided key. This is a intentionally notification and not a request
     * because the server is not supposed to act differently if the cache set failed.
     */
    public xcacheSet(params: CacheSetParams): void {
        this.notify('xcache/set', params)
    }

    /**
     * Diagnostics are sent from the server to the client to notify the user of errors/warnings
     * in a source file
     * @param params The diagnostics to send to the client
     */
    public textDocumentPublishDiagnostics(params: PublishDiagnosticsParams): void {
        this.notify('textDocument/publishDiagnostics', params)
    }

    /**
     * The workspace/applyEdit request is sent from the server to the client to modify resource on
     * the client side.
     *
     * @param params The edits to apply.
     */
    public workspaceApplyEdit(
        params: ApplyWorkspaceEditParams,
        childOf = new Span()
    ): Observable<ApplyWorkspaceEditResponse> {
        return this.request('workspace/applyEdit', params, childOf)
    }
}
