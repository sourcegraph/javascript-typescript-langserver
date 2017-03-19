
import * as ts from 'typescript';

import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';
export { CancellationToken, CancellationTokenSource };

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
