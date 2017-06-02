
import { Observable } from '@reactivex/rxjs';
import jsonpatch from 'fast-json-patch';

declare module '@reactivex/rxjs/dist/cjs/Observable' {
	interface Observable<T> {

		/**
		 * Reduces an Observable of JSON Patch Operations to a result, starting with `null`
		 */
		reduceOperations<R>(): Observable<R>;
	}
}

Observable.prototype.reduceOperations = function reduceOperations<T extends jsonpatch.Operation, R>(this: Observable<T>): Observable<R> {
	return this.reduce<T, R>(jsonpatch.applyReducer, null as any);
};
