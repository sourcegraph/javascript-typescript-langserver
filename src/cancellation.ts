import * as ts from 'typescript';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';
export { CancellationToken, CancellationTokenSource };

/**
 * Provides a token that is cancelled as soon as ALL added tokens are cancelled.
 * Useful for memoizing a function, where multiple consumers wait for the result of the same operation,
 * which should only be cancelled if all consumers requested cancellation.
 */
class CancellationTokenLink {

	/**
	 * Amount of total consumers
	 */
	private tokens = 0;

	/**
	 * Amount of consumers that have requested cancellation
	 */
	private cancelled = 0;

	/**
	 * Internal token source that is cancelled when all consumers request cancellation
	 */
	private source = new CancellationTokenSource();

	/**
	 * A linked CancellationToken that is cancelled as soon as all consumers request cancellation
	 */
	get token(): CancellationToken {
		return this.source.token;
	}

	/**
	 * Add another CancellationToken that needs to be cancelled to trigger cancellation
	 *
	 * @returns Disposable that allows to remove the token again
	 */
	add(token: CancellationToken): void {
		this.tokens++;
		token.onCancellationRequested(() => {
			this.cancelled++;
			// If all consumers requested cancellation, cancel
			if (this.cancelled === this.tokens) {
				this.source.cancel();
			}
		});
	}
}

/**
 * Memoizes the result of a promise-returning function by the first argument with support for cancellation.
 * If the last argument is a CancellationToken, the operation is only cancelled if all calls have requested cancellation.
 * Rejected (or cancelled) promises are automatically removed from the cache.
 * If the operation has already finished, it will not be cancelled.
 *
 * @param func Function to memoize
 * @param cache A custom Map to use for setting and getting cache items
 *
 * @template F The function to be memoized
 * @template T The return type of the function, must be Promise
 * @template K The cache key (first argument to the function)
 */
export function cancellableMemoize<F extends (...args: any[]) => T, T extends Promise<any>, K>(func: F, cache = new Map<K, T>()): F {
	// Track tokens consumers provide
	const tokenLinks = new Map<K, CancellationTokenLink>();
	const memoized: F = <any> function (this: any, ...args: any[]) {
		const key = args[0];
		// Get or create CancellationTokenLink for the given first parameter
		let tokenLink = tokenLinks.get(key);
		if (!tokenLink) {
			tokenLink = new CancellationTokenLink();
			tokenLinks.set(key, tokenLink);
		}
		// Take last argument as CancellationToken from arguments if provided or use a token that is never cancelled
		const token: CancellationToken = CancellationToken.is(args[args.length - 1]) ? args.pop() : CancellationToken.None;
		// Add it to the list of tokens that need to be cancelled for final cancellation
		tokenLink.add(token);
		let result: T;
		// Check if function has been called with this argument already
		if (cache.has(key)) {
			// Return previous result
			result = cache.get(key)!;
		} else {
			// Call function
			// Pass the linked cancel token
			args.push(tokenLink.token);
			result = <T> (<T> func.apply(this, args)).catch(err => {
				// Don't cache rejected promises
				cache.delete(key);
				throw err;
			});
			// Save result
			cache.set(key, result);
		}
		return result;
	};
	return memoized;
}

/**
 * Thrown when an operation was cancelled
 */
export class CancelledError extends Error {
	constructor(message = 'Operation cancelled') {
		super(message);
	}
}

/**
 * Returns true if the passed error was caused by a cancellation
 */
export function isCancelledError(error: any): boolean {
	return typeof error === 'object' && error !== null && (
		error instanceof CancelledError
		|| error instanceof ts.OperationCanceledException
		|| (typeof error.name === 'string' && error.name.includes('Cancel'))
	);
}

/**
 * Throws a CancelledError if cancellation was requested for the passed CancellationToken
 */
export function throwIfRequested(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new CancelledError();
	}
}

/**
 * Rethrows the passed error if it is a CancelledError
 */
export function throwIfCancelledError(err: any): void {
	if (isCancelledError(err)) {
		throw err;
	}
}
