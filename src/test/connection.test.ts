
import { Observable } from '@reactivex/rxjs';
import { EventEmitter } from 'events';
import { Span } from 'opentracing';
import * as sinon from 'sinon';
import { Event, MessageWriter } from 'vscode-jsonrpc';
import { ErrorCodes } from 'vscode-jsonrpc';
import { MessageEmitter, registerLanguageHandler } from '../connection';
import { NoopLogger } from '../logging';
import { TypeScriptService } from '../typescript-service';

describe('connection', () => {
	describe('registerLanguageHandler()', () => {
		it('should return MethodNotFound error when the method does not exist on handler', async () => {
			const handler: TypeScriptService = Object.create(TypeScriptService.prototype);
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as TypeScriptService);
			const params = [1, 1];
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'whatever', params });
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(writer.write);
			sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, error: { code: ErrorCodes.MethodNotFound } }));
		});
		it('should return MethodNotFound error when the method is prefixed with an underscore', async () => {
			const handler = { _privateMethod: sinon.spy() };
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as any as TypeScriptService);
			const params = [1, 1];
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params });
			sinon.assert.notCalled(handler._privateMethod);
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(writer.write);
			sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, error: { code: ErrorCodes.MethodNotFound } }));
		});
		it('should call a handler on request and send the result of the returned Promise', async () => {
			const handler: TypeScriptService = Object.create(TypeScriptService.prototype);
			const hoverStub = sinon.stub(handler, 'textDocumentHover').returns(Promise.resolve(2));
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as TypeScriptService);
			const params = [1, 1];
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params });
			sinon.assert.calledOnce(hoverStub);
			sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span));
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(writer.write);
			sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, result: 2 }));
		});
		it('should ignore exit notifications', async () => {
			const handler = {
				exit: sinon.spy()
			};
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as any);
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'exit' });
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.notCalled(handler.exit);
			sinon.assert.notCalled(writer.write);
		});
		it('should ignore responses', async () => {
			const handler = {
				whatever: sinon.spy()
			};
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as any);
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'whatever', result: 123 });
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.notCalled(handler.whatever);
		});
		it('should log invalid messages', async () => {
			const handler = {
				whatever: sinon.spy()
			};
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			const logger = new NoopLogger() as NoopLogger & { error: sinon.SinonStub };
			sinon.stub(logger, 'error');
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as any, { logger });
			emitter.emit('message', { jsonrpc: '2.0', id: 1 });
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(logger.error);
		});
		it('should call a handler on request and send the result of the returned Observable', async () => {
			const handler: TypeScriptService = Object.create(TypeScriptService.prototype);
			const hoverStub = sinon.stub(handler, 'textDocumentHover').returns(Observable.of(2));
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as TypeScriptService);
			const params = [1, 1];
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params });
			sinon.assert.calledOnce(hoverStub);
			sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span));
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(writer.write);
			sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, result: 2 }));
		});
		it('should call a handler on request and send the thrown error of the returned Observable', async () => {
			const handler: TypeScriptService = Object.create(TypeScriptService.prototype);
			const hoverStub = sinon.stub(handler, 'textDocumentHover').returns(Observable.throw(Object.assign(new Error('Something happened'), {
				code: ErrorCodes.serverErrorStart,
				whatever: 123
			})));
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as TypeScriptService);
			const params = [1, 1];
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params });
			sinon.assert.calledOnce(hoverStub);
			sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span));
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(writer.write);
			sinon.assert.calledWithExactly(writer.write, sinon.match({
				jsonrpc: '2.0',
				id: 1,
				error: {
					message: 'Something happened',
					code: ErrorCodes.serverErrorStart,
					data: { whatever: 123 }
				}
			}));
		});
		it('should call a handler on request and send the returned synchronous value', async () => {
			const handler: TypeScriptService = Object.create(TypeScriptService.prototype);
			const hoverStub = sinon.stub(handler, 'textDocumentHover').returns(2);
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as TypeScriptService);
			const params = [1, 1];
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params });
			sinon.assert.calledOnce(hoverStub);
			sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span));
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(writer.write);
			sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, result: 2 }));
		});
		it('should call a handler on request and send the result of the returned Observable', async () => {
			const handler: TypeScriptService = Object.create(TypeScriptService.prototype);
			const hoverStub = sinon.stub(handler, 'textDocumentHover').returns(Observable.of(2));
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as TypeScriptService);
			const params = [1, 1];
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params });
			sinon.assert.calledOnce(hoverStub);
			sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span));
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(writer.write);
			sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, result: 2 }));
		});
		it('should unsubscribe from the returned Observable when $/cancelRequest was sent and return a RequestCancelled error', async () => {
			const handler: TypeScriptService = Object.create(TypeScriptService.prototype);
			const unsubscribeHandler = sinon.spy();
			const hoverStub = sinon.stub(handler, 'textDocumentHover').returns(new Observable(subscriber => unsubscribeHandler));
			const emitter = new EventEmitter();
			const writer = {
				write: sinon.spy(),
				onError: Event.None,
				onClose: Event.None
			};
			registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as TypeScriptService);
			const params = [1, 1];
			emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params });
			sinon.assert.calledOnce(hoverStub);
			sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span));
			emitter.emit('message', { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } });
			await new Promise(resolve => setTimeout(resolve, 0));
			sinon.assert.calledOnce(unsubscribeHandler);
			sinon.assert.calledOnce(writer.write);
			sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, error: { code: ErrorCodes.RequestCancelled } }));
		});
		for (const event of ['close', 'error']) {
			it(`should call shutdown on ${event} if the service was initialized`, async () => {
				const handler = {
					initialize: sinon.stub(),
					shutdown: sinon.stub()
				};
				const emitter = new EventEmitter();
				const writer = {
					write: sinon.spy(),
					onError: Event.None,
					onClose: Event.None
				};
				registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as any as TypeScriptService);
				emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
				await new Promise(resolve => setTimeout(resolve, 0));
				sinon.assert.calledOnce(handler.initialize);
				emitter.emit(event);
				sinon.assert.calledOnce(handler.shutdown);
			});
			it(`should not call shutdown on ${event} if the service was not initialized`, async () => {
				const handler = {
					initialize: sinon.stub(),
					shutdown: sinon.stub()
				};
				const emitter = new EventEmitter();
				const writer = {
					write: sinon.spy(),
					onError: Event.None,
					onClose: Event.None
				};
				registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as any as TypeScriptService);
				emitter.emit(event);
				sinon.assert.notCalled(handler.shutdown);
			});
			it(`should not call shutdown again on ${event} if shutdown was already called`, async () => {
				const handler = {
					initialize: sinon.stub(),
					shutdown: sinon.stub()
				};
				const emitter = new EventEmitter();
				const writer = {
					write: sinon.spy(),
					onError: Event.None,
					onClose: Event.None
				};
				registerLanguageHandler(emitter as MessageEmitter, writer as MessageWriter, handler as any as TypeScriptService);
				emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'shutdown', params: {} });
				await new Promise(resolve => setTimeout(resolve, 0));
				sinon.assert.calledOnce(handler.shutdown);
				emitter.emit(event);
				sinon.assert.calledOnce(handler.shutdown);
			});
		}
	});
});
