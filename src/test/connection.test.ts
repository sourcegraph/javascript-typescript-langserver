import * as assert from 'assert'
import { EventEmitter } from 'events'
import { Operation } from 'fast-json-patch'
import { Span } from 'opentracing'
import { Observable, Subject } from 'rxjs'
import * as sinon from 'sinon'
import { PassThrough } from 'stream'
import { ErrorCodes } from 'vscode-jsonrpc'
import { MessageEmitter, MessageWriter, registerLanguageHandler } from '../connection'
import { NoopLogger } from '../logging'
import { TypeScriptService } from '../typescript-service'

describe('connection', () => {
    describe('registerLanguageHandler()', () => {
        it('should return MethodNotFound error when the method does not exist on handler', async () => {
            const handler: TypeScriptService = Object.create(TypeScriptService.prototype)
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(
                emitter as MessageEmitter,
                (writer as any) as MessageWriter,
                handler as TypeScriptService
            )
            const params = [1, 1]
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'whatever', params })
            sinon.assert.calledOnce(writer.write)
            sinon.assert.calledWithExactly(
                writer.write,
                sinon.match({ jsonrpc: '2.0', id: 1, error: { code: ErrorCodes.MethodNotFound } })
            )
        })
        it('should return MethodNotFound error when the method is prefixed with an underscore', async () => {
            const handler = { _privateMethod: sinon.spy() }
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any)
            const params = [1, 1]
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params })
            sinon.assert.notCalled(handler._privateMethod)
            sinon.assert.calledOnce(writer.write)
            sinon.assert.calledWithExactly(
                writer.write,
                sinon.match({ jsonrpc: '2.0', id: 1, error: { code: ErrorCodes.MethodNotFound } })
            )
        })
        it('should call a handler on request and send the result of the returned Promise', async () => {
            const handler: {
                [K in keyof TypeScriptService]: TypeScriptService[K] & sinon.SinonStub
            } = sinon.createStubInstance(TypeScriptService)
            handler.initialize.returns(Promise.resolve({ op: 'add', path: '', value: { capabilities: {} } }))
            handler.textDocumentHover.returns(Promise.resolve(2))
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any)
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } })
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            sinon.assert.calledOnce(handler.initialize)
            sinon.assert.calledWithExactly(
                writer.write,
                sinon.match({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } })
            )
        })
        it('should ignore exit notifications', async () => {
            const handler = {
                exit: sinon.spy(),
            }
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any)
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'exit' })
            sinon.assert.notCalled(handler.exit)
            sinon.assert.notCalled(writer.write)
        })
        it('should ignore responses', async () => {
            const handler = {
                whatever: sinon.spy(),
            }
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any)
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'whatever', result: 123 })
            sinon.assert.notCalled(handler.whatever)
        })
        it('should log invalid messages', async () => {
            const handler = {
                whatever: sinon.spy(),
            }
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            const logger = new NoopLogger() as NoopLogger & { error: sinon.SinonStub }
            sinon.stub(logger, 'error')
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any, { logger })
            emitter.emit('message', { jsonrpc: '2.0', id: 1 })
            sinon.assert.calledOnce(logger.error)
        })
        it('should call a handler on request and send the result of the returned Observable', async () => {
            const handler: TypeScriptService = Object.create(TypeScriptService.prototype)
            const hoverStub = sinon
                .stub(handler, 'textDocumentHover')
                .returns(
                    Observable.of<Operation>({ op: 'add', path: '', value: [] }, { op: 'add', path: '/-', value: 123 })
                )
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as TypeScriptService)
            const params = [1, 1]
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params })
            sinon.assert.calledOnce(hoverStub)
            sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span))
            sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, result: [123] }))
        })
        it('should call a handler on request and send the thrown error of the returned Observable', async () => {
            const handler: TypeScriptService = Object.create(TypeScriptService.prototype)
            const hoverStub = sinon.stub(handler, 'textDocumentHover').returns(
                Observable.throw(
                    Object.assign(new Error('Something happened'), {
                        code: ErrorCodes.serverErrorStart,
                        whatever: 123,
                    })
                )
            )
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as TypeScriptService)
            const params = [1, 1]
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params })
            sinon.assert.calledOnce(hoverStub)
            sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span))
            sinon.assert.calledOnce(writer.write)
            sinon.assert.calledWithExactly(
                writer.write,
                sinon.match({
                    jsonrpc: '2.0',
                    id: 1,
                    error: {
                        message: 'Something happened',
                        code: ErrorCodes.serverErrorStart,
                        data: { whatever: 123 },
                    },
                })
            )
        })
        it('should call a handler on request and send the returned synchronous value', async () => {
            const handler: TypeScriptService = Object.create(TypeScriptService.prototype)
            const hoverStub = sinon
                .stub(handler, 'textDocumentHover')
                .returns(Observable.of({ op: 'add', path: '', value: 2 }))
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as TypeScriptService)
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: [1, 2] })
            sinon.assert.calledOnce(hoverStub)
            sinon.assert.calledWithExactly(hoverStub, [1, 2], sinon.match.instanceOf(Span))
            sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, result: 2 }))
        })
        it('should call a handler on request and send the result of the returned Observable', async () => {
            const handler: TypeScriptService = Object.create(TypeScriptService.prototype)
            const hoverStub = sinon
                .stub(handler, 'textDocumentHover')
                .returns(Observable.of({ op: 'add', path: '', value: 2 }))
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as TypeScriptService)
            const params = [1, 1]
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params })
            sinon.assert.calledOnce(hoverStub)
            sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span))
            sinon.assert.calledWithExactly(writer.write, sinon.match({ jsonrpc: '2.0', id: 1, result: 2 }))
        })
        it('should unsubscribe from the returned Observable when $/cancelRequest was sent and return a RequestCancelled error', async () => {
            const handler: TypeScriptService = Object.create(TypeScriptService.prototype)
            const unsubscribeHandler = sinon.spy()
            const hoverStub = sinon
                .stub(handler, 'textDocumentHover')
                .returns(new Observable<never>(subscriber => unsubscribeHandler))
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as TypeScriptService)
            const params = [1, 1]
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params })
            sinon.assert.calledOnce(hoverStub)
            sinon.assert.calledWithExactly(hoverStub, params, sinon.match.instanceOf(Span))
            emitter.emit('message', { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } })
            sinon.assert.calledOnce(unsubscribeHandler)
            sinon.assert.calledOnce(writer.write)
            sinon.assert.calledWithExactly(
                writer.write,
                sinon.match({ jsonrpc: '2.0', id: 1, error: { code: ErrorCodes.RequestCancelled } })
            )
        })
        it('should unsubscribe from the returned Observable when the connection was closed', async () => {
            const handler: TypeScriptService = Object.create(TypeScriptService.prototype)
            const unsubscribeHandler = sinon.spy()
            const hoverStub = sinon
                .stub(handler, 'textDocumentHover')
                .returns(new Observable<never>(subscriber => unsubscribeHandler))
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as TypeScriptService)
            const params = [1, 1]
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params })
            sinon.assert.calledOnce(hoverStub)
            emitter.emit('close')
            sinon.assert.calledOnce(unsubscribeHandler)
        })
        it('should unsubscribe from the returned Observable on exit notification', async () => {
            const handler: TypeScriptService = Object.create(TypeScriptService.prototype)
            const unsubscribeHandler = sinon.spy()
            const hoverStub = sinon
                .stub(handler, 'textDocumentHover')
                .returns(new Observable<never>(subscriber => unsubscribeHandler))
            const emitter = new EventEmitter()
            const writer = {
                write: sinon.spy(),
            }
            registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as TypeScriptService)
            const params = [1, 1]
            emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params })
            sinon.assert.calledOnce(hoverStub)
            emitter.emit('message', { jsonrpc: '2.0', method: 'exit' })
            sinon.assert.calledOnce(unsubscribeHandler)
        })
        for (const event of ['close', 'error']) {
            it(`should call shutdown on ${event} if the service was initialized`, async () => {
                const handler = {
                    initialize: sinon
                        .stub()
                        .returns(Observable.of({ op: 'add', path: '', value: { capabilities: {} } })),
                    shutdown: sinon.stub().returns(Observable.of({ op: 'add', path: '', value: null })),
                }
                const emitter = new EventEmitter()
                const writer = {
                    write: sinon.spy(),
                }
                registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any)
                emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } })

                sinon.assert.calledOnce(handler.initialize)
                emitter.emit(event)
                sinon.assert.calledOnce(handler.shutdown)
            })
            it(`should not call shutdown on ${event} if the service was not initialized`, async () => {
                const handler = {
                    initialize: sinon
                        .stub()
                        .returns(Observable.of({ op: 'add', path: '', value: { capabilities: {} } })),
                    shutdown: sinon.stub().returns(Observable.of({ op: 'add', path: '', value: null })),
                }
                const emitter = new EventEmitter()
                const writer = {
                    write: sinon.spy(),
                }
                registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any)
                emitter.emit(event)
                sinon.assert.notCalled(handler.shutdown)
            })
            it(`should not call shutdown again on ${event} if shutdown was already called`, async () => {
                const handler = {
                    initialize: sinon
                        .stub()
                        .returns(Observable.of({ op: 'add', path: '', value: { capabilities: {} } })),
                    shutdown: sinon.stub().returns(Observable.of({ op: 'add', path: '', value: null })),
                }
                const emitter = new EventEmitter()
                const writer = {
                    write: sinon.spy(),
                }
                registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any)
                emitter.emit('message', { jsonrpc: '2.0', id: 1, method: 'shutdown', params: {} })

                sinon.assert.calledOnce(handler.shutdown)
                emitter.emit(event)
                sinon.assert.calledOnce(handler.shutdown)
            })
        }
        describe('Client with streaming support', () => {
            it('should call a handler on request and send partial results of the returned Observable', async () => {
                const handler: {
                    [K in keyof TypeScriptService]: TypeScriptService[K] & sinon.SinonStub
                } = sinon.createStubInstance(TypeScriptService)
                handler.initialize.returns(
                    Observable.of({ op: 'add', path: '', value: { capabilities: { streaming: true } } })
                )

                const hoverSubject = new Subject<Operation>()
                handler.textDocumentHover.returns(hoverSubject)

                const emitter = new EventEmitter()
                const writer = {
                    write: sinon.spy(),
                }

                registerLanguageHandler(emitter as MessageEmitter, writer as any, handler as any)

                // Send initialize
                emitter.emit('message', {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: { capabilities: { streaming: true } },
                })
                assert.deepEqual(
                    writer.write.args[0],
                    [
                        {
                            jsonrpc: '2.0',
                            method: '$/partialResult',
                            params: {
                                id: 1,
                                patch: [{ op: 'add', path: '', value: { capabilities: { streaming: true } } }],
                            },
                        },
                    ],
                    'Expected to send partial result for initialize'
                )
                assert.deepEqual(
                    writer.write.args[1],
                    [
                        {
                            jsonrpc: '2.0',
                            id: 1,
                            result: { capabilities: { streaming: true } },
                        },
                    ],
                    'Expected to send final result for initialize'
                )

                // Send hover
                emitter.emit('message', { jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: [1, 2] })
                sinon.assert.calledOnce(handler.textDocumentHover)

                // Simulate initializing JSON Patch Operation
                hoverSubject.next({ op: 'add', path: '', value: [] })
                assert.deepEqual(
                    writer.write.args[2],
                    [
                        {
                            jsonrpc: '2.0',
                            method: '$/partialResult',
                            params: { id: 2, patch: [{ op: 'add', path: '', value: [] }] },
                        },
                    ],
                    'Expected to send partial result that initializes array'
                )

                // Simulate streamed value
                hoverSubject.next({ op: 'add', path: '/-', value: 123 })
                assert.deepEqual(
                    writer.write.args[3],
                    [
                        {
                            jsonrpc: '2.0',
                            method: '$/partialResult',
                            params: { id: 2, patch: [{ op: 'add', path: '/-', value: 123 }] },
                        },
                    ],
                    'Expected to send partial result that adds 123 to array'
                )

                // Complete Subject to trigger final response
                hoverSubject.complete()
                assert.deepEqual(
                    writer.write.args[4],
                    [
                        {
                            jsonrpc: '2.0',
                            id: 2,
                            result: [123],
                        },
                    ],
                    'Expected to send final result [123]'
                )
            })
        })
    })
    describe('MessageEmitter', () => {
        it('should log messages if enabled', async () => {
            const logger = new NoopLogger() as NoopLogger & { log: sinon.SinonStub }
            sinon.stub(logger, 'log')
            const emitter = new MessageEmitter(new PassThrough(), { logMessages: true, logger })
            emitter.emit('message', { jsonrpc: '2.0', method: 'whatever' })
            sinon.assert.calledOnce(logger.log)
            sinon.assert.calledWith(logger.log, '-->')
        })
        it('should not log messages if disabled', async () => {
            const logger = new NoopLogger() as NoopLogger & { log: sinon.SinonStub }
            sinon.stub(logger, 'log')
            const emitter = new MessageEmitter(new PassThrough(), { logMessages: false, logger })
            emitter.emit('message', { jsonrpc: '2.0', method: 'whatever' })
            sinon.assert.notCalled(logger.log)
        })
    })
    describe('MessageWriter', () => {
        it('should log messages if enabled', async () => {
            const logger = new NoopLogger() as NoopLogger & { log: sinon.SinonStub }
            sinon.stub(logger, 'log')
            const writer = new MessageWriter(new PassThrough(), { logMessages: true, logger })
            writer.write({ jsonrpc: '2.0', method: 'whatever' })
            sinon.assert.calledOnce(logger.log)
            sinon.assert.calledWith(logger.log, '<--')
        })
        it('should not log messages if disabled', async () => {
            const logger = new NoopLogger() as NoopLogger & { log: sinon.SinonStub }
            sinon.stub(logger, 'log')
            const writer = new MessageWriter(new PassThrough(), { logMessages: false, logger })
            writer.write({ jsonrpc: '2.0', method: 'whatever' })
            sinon.assert.notCalled(logger.log)
        })
    })
})
