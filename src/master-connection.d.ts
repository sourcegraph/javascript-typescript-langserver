import { IConnection } from 'vscode-languageserver';
/**
 * registerMasterHandler registers a language server handler on the
 * main connection (first parameter) that delegates work to two
 * workers (accessible through the connections named by parameters one
 * and two). Worker one is the "canonical" worker. It receives all
 * requests sent to the master. Worker two is an auxiliary, used to
 * speed up certain operations that we would not like to block on
 * other operations. (Due to the constraints of the Node.js runtime,
 * the master and each worker has only one thread of execution.)
 *
 * On hover and definition requests, the master handler will return
 * the first successful response from either of the two workers. On
 * symbol and references requests, the master handler will only
 * delegate to worker one. On initialize, the master handler forwards
 * the request to both workers, but only returns the response from
 * worker one. All notifications are forwarded to both workers.
 */
export declare function registerMasterHandler(connection: IConnection, one: IConnection, two: IConnection): void;
