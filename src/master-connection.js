"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const rt = require("./request-type");
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
function registerMasterHandler(connection, one, two) {
    connection.onRequest(rt.InitializeRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        const resultOne = one.sendRequest(rt.InitializeRequest.type, params);
        two.sendRequest(rt.InitializeRequest.type, params);
        return resultOne;
    }));
    connection.onShutdown(() => {
        for (const worker of [one, two]) {
            worker.sendRequest(rt.ShutdownRequest.type);
            // The master's exit notification is not forwarded to the worker, so send it here.
            worker.sendNotification(rt.ExitRequest.type);
        }
    });
    connection.onDidOpenTextDocument((params) => {
        for (const worker of [one, two]) {
            worker.sendNotification(rt.TextDocumentDidOpenNotification.type, params);
        }
    });
    connection.onDidChangeTextDocument((params) => {
        for (const worker of [one, two]) {
            worker.sendNotification(rt.TextDocumentDidChangeNotification.type, params);
        }
    });
    connection.onDidSaveTextDocument((params) => {
        for (const worker of [one, two]) {
            worker.sendNotification(rt.TextDocumentDidSaveNotification.type, params);
        }
    });
    connection.onDidCloseTextDocument((params) => {
        for (const worker of [one, two]) {
            worker.sendNotification(rt.TextDocumentDidCloseNotification.type, params);
        }
    });
    connection.onDefinition((params) => __awaiter(this, void 0, void 0, function* () {
        const resps = [one, two].map((worker) => {
            return worker.sendRequest(rt.DefinitionRequest.type, params);
        });
        return promiseFirstSuccess(resps);
    }));
    connection.onHover((params) => __awaiter(this, void 0, void 0, function* () {
        const resps = [one, two].map((worker) => {
            return worker.sendRequest(rt.HoverRequest.type, params);
        });
        return promiseFirstSuccess(resps);
    }));
    connection.onRequest(rt.WorkspaceSymbolsRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        return one.sendRequest(rt.WorkspaceSymbolsRequest.type, params);
    }));
    connection.onRequest(rt.DocumentSymbolRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        return one.sendRequest(rt.DocumentSymbolRequest.type, params);
    }));
    connection.onRequest(rt.WorkspaceReferenceRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        return one.sendRequest(rt.WorkspaceReferenceRequest.type, params);
    }));
    connection.onReferences((params) => __awaiter(this, void 0, void 0, function* () {
        return one.sendRequest(rt.ReferencesRequest.type, params);
    }));
}
exports.registerMasterHandler = registerMasterHandler;
function promiseFirstSuccess(promises) {
    return new Promise((resolve, reject) => {
        let doneCt = 0;
        for (const p of promises) {
            p.then((result) => {
                doneCt++;
                if (doneCt > 1) {
                    return;
                }
                return resolve(result);
            }, (err) => {
                doneCt++;
                if (doneCt === 2) {
                    return reject(err);
                }
                return;
            });
        }
    });
}
//# sourceMappingURL=master-connection.js.map