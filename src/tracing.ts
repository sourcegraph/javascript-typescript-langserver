
// import { ReplaySubject } from '@reactivex/rxjs';
// import { Span } from 'opentracing';

// const S_SPAN = Symbol('span');

// export class LazySpan {

// 	private readonly tags = new ReplaySubject<{ key: string, value: any }>();
// 	private readonly baggageItems = new ReplaySubject<{ key: string, value: any }>();
// 	private readonly finished = new ReplaySubject<number>();
// 	private readonly operationName = new ReplaySubject<string>();
// 	private readonly logs = new ReplaySubject<{ fields: { [key: string]: any }, timestamp: number }>();
// 	private readonly children = new Set<LazySpan>();

// 	setOperationName(name: string): this {
// 		this.operationName.next(name);
// 		return this;
// 	}

// 	setBaggageItem(key: string, value: any): this {
// 		this.baggageItems.next({ key, value });
// 		return this;
// 	}

// 	setTag(key: string, value: any): this {
// 		this.tags.next({ key, value });
// 		return this;
// 	}

// 	addTags(tags: { [key: string]: any }): this {
// 		for (const key of Object.keys(tags)) {
// 			this.tags.next({ key, value: tags[key] });
// 		}
// 		return this;
// 	}

// 	finish(finishTime = Date.now()): void {
// 		this.finished.complete();
// 	}

// 	log(fields: { [key: string]: any }, timestamp = Date.now()): this {
// 		this.logs.next({ fields, timestamp });
// 		return this;
// 	}

// 	traceChild<T extends any>(traced: T): T {
// 		if (traced[S_SPAN]) {
// 			this.children.add(traced[S_SPAN]);
// 		}
// 		return traced;
// 	}

// 	setParent(realParent: Span): void {
// 		this.operationName.take(1).subscribe(name => {
// 			const realSpan = realParent.tracer().startSpan(name, { childOf: realParent });
// 			this.tags.subscribe(({ key, value }) => {
// 				realSpan.setTag(key, value);
// 			});
// 			this.baggageItems.subscribe(({ key, value }) => {
// 				realSpan.setBaggageItem(key, value);
// 			});
// 			this.logs.subscribe(({ fields, timestamp }) => {
// 				realSpan.log(fields, timestamp);
// 			});
// 			this.finished.subscribe(finishTime => {
// 				realSpan.finish(finishTime);
// 			});
// 			this.operationName.subscribe(name => {
// 				realSpan.setOperationName(name);
// 			});
// 			for (const child of this.children) {
// 				child.setParent(realSpan);
// 			}
// 		});
// 	}
// }

// export function trace<R extends object>(operationName: string, fn: (span: LazySpan) => R): R {
// 	const span = new LazySpan();
// 	span.setOperationName(operationName);
// 	const r = fn(span);
// 	if (typeof r.then === 'function') {
// 		r = r.then(res => {
// 			span.finish();
// 		}, err => {
// 			span.setTag('error', true);
// 			span.log({ event: 'error', 'error.object': err });
// 			span.finish();
// 			throw err;
// 		});
// 	}
// 	(r as any)[S_SPAN] = span;
// 	return r;
// }

// export function traceChild<T>(traced: T, parent: Span | LazySpan): T {
// 	const lazySpan: LazySpan = (traced as any)[S_SPAN];
// 	if (lazySpan) {
// 		if (parent instanceof LazySpan) {
// 			parent.traceChild(lazySpan);
// 		} else {
// 			lazySpan.setParent(parent);
// 		}
// 	}
// 	return traced;
// }

// function foo() {
// 	return trace('foo', async span => {
// 		span.setTag('whatever', 123);
// 	});
// }

// function bar() {
// 	return trace('bar', async span => {
// 		await span.traceChild(foo());
// 	});
// }

// async function baz() {
// 	const span = globalTracer().startSpan('baz');
// 	await traceChild(bar(), span);
// }
