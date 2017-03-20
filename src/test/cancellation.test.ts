
import * as chai from 'chai';
import { cancellableMemoize, CancellationToken, CancellationTokenSource, CancelledError } from '../cancellation';
import chaiAsPromised = require('chai-as-promised');
import * as sinon from 'sinon';
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('cancellation', () => {
	describe('cancellableMemoize()', () => {
		it('should memoize a function by the first argument', async () => {
			const toBeMemoized = sinon.spy((arg1: number, arg2: number, token = CancellationToken.None): Promise<number> => {
				return Promise.resolve(Math.random());
			});
			const memoized = cancellableMemoize(toBeMemoized);
			const a = await memoized(123, 456);
			const b = await memoized(123, 456);
			sinon.assert.calledOnce(toBeMemoized);
			sinon.assert.calledWith(toBeMemoized, 123, 456, sinon.match.object);
			assert.equal(a, b);
		});
		it('should memoize a function without parameters', async () => {
			const toBeMemoized = sinon.spy((token = CancellationToken.None): Promise<number> => {
				return Promise.resolve(Math.random());
			});
			const memoized = cancellableMemoize(toBeMemoized);
			const a = await memoized();
			const b = await memoized();
			assert.equal(a, b);
			sinon.assert.calledOnce(toBeMemoized);
			sinon.assert.calledWith(toBeMemoized, sinon.match.object);
		});
		it('should not cancel the operation if there are still consumers', async () => {
			const toBeMemoized = sinon.spy((arg: number, token = CancellationToken.None): Promise<number> => {
				return new Promise((resolve, reject) => {
					token.onCancellationRequested(() => {
						reject(new CancelledError());
					});
					setTimeout(() => resolve(123), 500);
				});
			});
			const memoized = cancellableMemoize(toBeMemoized);
			const source1 = new CancellationTokenSource();
			const source2 = new CancellationTokenSource();
			const promise1 = memoized(123, source1.token);
			const promise2 = memoized(123, source2.token);
			source1.cancel();
			assert.equal(await promise1, 123);
			assert.equal(await promise2, 123);
			sinon.assert.calledOnce(toBeMemoized);
			sinon.assert.calledWith(toBeMemoized, 123, sinon.match.object);
		});
		it('should cancel the operation if all consumers requested cancellation', async () => {
			const toBeMemoized = sinon.spy((arg: number, token: CancellationToken): Promise<number> => {
				return new Promise((resolve, reject) => {
					token.onCancellationRequested(() => {
						reject(new CancelledError());
					});
					setTimeout(() => resolve(123), 500);
				});
			});
			const memoized = cancellableMemoize(toBeMemoized);
			const source1 = new CancellationTokenSource();
			const source2 = new CancellationTokenSource();
			const promise1 = memoized(123, source1.token);
			const promise2 = memoized(123, source2.token);
			source1.cancel();
			source2.cancel();
			sinon.assert.calledOnce(toBeMemoized);
			sinon.assert.calledWith(toBeMemoized, 123, sinon.match.object);
			await assert.isRejected(promise1, /cancel/i);
			await assert.isRejected(promise2, /cancel/i);
		});
	});
});
