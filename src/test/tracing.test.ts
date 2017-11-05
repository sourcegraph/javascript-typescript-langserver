import * as chai from 'chai'
import chaiAsPromised = require('chai-as-promised')
import { Span } from 'opentracing'
import { Observable } from 'rxjs'
import * as sinon from 'sinon'
import { traceObservable, tracePromise, traceSync } from '../tracing'
chai.use(chaiAsPromised)
const assert = chai.assert

describe('tracing.ts', () => {
    let sandbox: sinon.SinonSandbox
    beforeEach(() => {
        sandbox = sinon.sandbox.create()
    })
    afterEach(() => {
        sandbox.restore()
    })
    describe('traceSync()', () => {
        it('should trace the error if the function throws', () => {
            let setTagStub: sinon.SinonStub | undefined
            let logStub: sinon.SinonStub | undefined
            let finishStub: sinon.SinonStub | undefined
            assert.throws(() => {
                traceSync('Foo', new Span(), span => {
                    setTagStub = sandbox.stub(span, 'setTag')
                    logStub = sandbox.stub(span, 'log')
                    finishStub = sandbox.stub(span, 'finish')
                    throw new Error('Bar')
                })
            }, 'Bar')
            sinon.assert.calledOnce(setTagStub!)
            sinon.assert.calledOnce(logStub!)
            sinon.assert.calledWith(setTagStub!, 'error', true)
            sinon.assert.calledWith(logStub!, sinon.match({ event: 'error', message: 'Bar' }))
            sinon.assert.calledOnce(finishStub!)
        })
    })
    describe('tracePromise()', () => {
        it('should trace the error if the Promise is rejected', async () => {
            let setTagStub: sinon.SinonStub | undefined
            let logStub: sinon.SinonStub | undefined
            let finishStub: sinon.SinonStub | undefined
            await Promise.resolve(
                assert.isRejected(
                    tracePromise('Foo', new Span(), async span => {
                        setTagStub = sandbox.stub(span, 'setTag')
                        logStub = sandbox.stub(span, 'log')
                        finishStub = sandbox.stub(span, 'finish')
                        throw new Error('Bar')
                    }),
                    'Bar'
                )
            )
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            sinon.assert.calledOnce(setTagStub!)
            sinon.assert.calledOnce(logStub!)
            sinon.assert.calledWith(setTagStub!, 'error', true)
            sinon.assert.calledWith(logStub!, sinon.match({ event: 'error', message: 'Bar' }))
            sinon.assert.calledOnce(finishStub!)
        })
        it('should trace the error if the function throws an Error', async () => {
            let setTagStub: sinon.SinonStub | undefined
            let logStub: sinon.SinonStub | undefined
            let finishStub: sinon.SinonStub | undefined
            await Promise.resolve(
                assert.isRejected(
                    tracePromise('Foo', new Span(), span => {
                        setTagStub = sandbox.stub(span, 'setTag')
                        logStub = sandbox.stub(span, 'log')
                        finishStub = sandbox.stub(span, 'finish')
                        throw new Error('Bar')
                    }),
                    'Bar'
                )
            )
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            sinon.assert.calledOnce(setTagStub!)
            sinon.assert.calledOnce(logStub!)
            sinon.assert.calledWith(setTagStub!, 'error', true)
            sinon.assert.calledWith(logStub!, sinon.match({ event: 'error', message: 'Bar' }))
            sinon.assert.calledOnce(finishStub!)
        })
    })
    describe('traceObservable()', () => {
        it('should trace the error if the Observable errors', async () => {
            let setTagStub: sinon.SinonStub | undefined
            let logStub: sinon.SinonStub | undefined
            let finishStub: sinon.SinonStub | undefined
            await Promise.resolve(
                assert.isRejected(
                    traceObservable('Foo', new Span(), span => {
                        setTagStub = sandbox.stub(span, 'setTag')
                        logStub = sandbox.stub(span, 'log')
                        finishStub = sandbox.stub(span, 'finish')
                        return Observable.throw(new Error('Bar'))
                    }).toPromise(),
                    'Bar'
                )
            )
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            sinon.assert.calledOnce(setTagStub!)
            sinon.assert.calledOnce(logStub!)
            sinon.assert.calledWith(setTagStub!, 'error', true)
            sinon.assert.calledWith(logStub!, sinon.match({ event: 'error', message: 'Bar' }))
            sinon.assert.calledOnce(finishStub!)
        })
        it('should trace the error if the function throws an Error', async () => {
            let setTagStub: sinon.SinonStub | undefined
            let logStub: sinon.SinonStub | undefined
            let finishStub: sinon.SinonStub | undefined
            await Promise.resolve(
                assert.isRejected(
                    traceObservable('Foo', new Span(), span => {
                        setTagStub = sandbox.stub(span, 'setTag')
                        logStub = sandbox.stub(span, 'log')
                        finishStub = sandbox.stub(span, 'finish')
                        throw new Error('Bar')
                    }).toPromise(),
                    'Bar'
                )
            )
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            sinon.assert.calledOnce(setTagStub!)
            sinon.assert.calledOnce(logStub!)
            sinon.assert.calledWith(setTagStub!, 'error', true)
            sinon.assert.calledWith(logStub!, sinon.match({ event: 'error', message: 'Bar' }))
            sinon.assert.calledOnce(finishStub!)
        })
    })
})
