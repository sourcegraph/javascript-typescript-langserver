"use strict";
const net = require("net");
const chai = require("chai");
const connection_1 = require("../connection");
const rt = require("../request-type");
class Channel {
}
let channel;
function setUp(langhandler, memfs, done) {
    channel = new Channel();
    let counter = 2;
    function maybeDone() {
        counter--;
        if (counter === 0) {
            channel.serverConnection.listen();
            channel.clientConnection.listen();
            const params = {
                processId: 99,
                rootPath: 'file:///',
                capabilities: {},
            };
            channel.clientConnection.sendRequest(rt.InitializeRequest.type, params).then(() => {
                done();
            }, (e) => {
                console.error(e);
                return done(new Error('initialization failed'));
            });
        }
    }
    channel.server = net.createServer((stream) => {
        channel.serverIn = stream;
        channel.serverConnection = connection_1.newConnection(channel.serverIn, channel.serverOut);
        connection_1.registerLanguageHandler(channel.serverConnection, true, langhandler);
        maybeDone();
    });
    channel.client = net.createServer((stream) => {
        channel.clientIn = stream;
        channel.clientConnection = connection_1.newConnection(channel.clientIn, channel.clientOut);
        initFs(channel.clientConnection, memfs);
        maybeDone();
    });
    channel.server.listen(0, () => {
        channel.client.listen(0, () => {
            channel.clientOut = net.connect(channel.server.address().port);
            channel.serverOut = net.connect(channel.client.address().port);
        });
    });
}
exports.setUp = setUp;
function initFs(connection, memfs) {
    connection.onRequest(rt.ReadDirRequest.type, (params) => {
        params = params.substring(1);
        const path = params.length ? params.split('/') : [];
        let node = memfs;
        let i = 0;
        while (i < path.length) {
            node = node[path[i]];
            if (!node || typeof node != 'object') {
                throw new Error('no such file: ' + params);
            }
            i++;
        }
        const keys = Object.keys(node);
        let result = [];
        keys.forEach((k) => {
            const v = node[k];
            if (typeof v == 'string') {
                result.push({
                    name: k,
                    size: v.length,
                    dir: false
                });
            }
            else {
                result.push({
                    name: k,
                    size: 0,
                    dir: true
                });
            }
        });
        return result;
    });
    connection.onRequest(rt.ReadFileRequest.type, (params) => {
        params = params.substring(1);
        const path = params.length ? params.split('/') : [];
        let node = memfs;
        let i = 0;
        while (i < path.length - 1) {
            node = node[path[i]];
            if (!node || typeof node != 'object') {
                throw new Error('no such file: ' + params);
            }
            i++;
        }
        const content = node[path[path.length - 1]];
        if (!content || typeof content != 'string') {
            throw new Error('no such file');
        }
        return new Buffer(content).toString('base64');
    });
}
function tearDown(done) {
    channel.clientConnection.sendRequest(rt.ShutdownRequest.type).then(() => {
        channel.clientConnection.sendNotification(rt.ExitRequest.type);
        channel.client.close();
        channel.server.close();
        done();
    }, (e) => {
        console.error("error on tearDown:", e);
    });
}
exports.tearDown = tearDown;
function check(done, conditions) {
    try {
        conditions();
        done();
    }
    catch (err) {
        done(err);
    }
}
function definition(pos, expected, done) {
    channel.clientConnection.sendRequest(rt.DefinitionRequest.type, {
        textDocument: {
            uri: pos.textDocument.uri
        },
        position: {
            line: pos.position.line,
            character: pos.position.character
        }
    }).then((results) => {
        expected = expected ? (Array.isArray(expected) ? expected : [expected]) : null;
        check(done, () => {
            chai.expect(results).to.deep.equal(expected);
        });
    }, (err) => {
        return done(err || new Error('definition request failed'));
    });
}
exports.definition = definition;
function hover(pos, expected, done) {
    channel.clientConnection.sendRequest(rt.HoverRequest.type, {
        textDocument: {
            uri: pos.textDocument.uri
        },
        position: {
            line: pos.position.line,
            character: pos.position.character
        }
    }).then((result) => {
        check(done, () => {
            chai.expect(result.contents).to.deep.equal(expected.contents);
        });
    }, (err) => {
        return done(err || new Error('hover request failed'));
    });
}
exports.hover = hover;
function references(pos, expected, done) {
    channel.clientConnection.sendRequest(rt.ReferencesRequest.type, {
        textDocument: {
            uri: pos.textDocument.uri,
        },
        position: {
            line: pos.position.line,
            character: pos.position.character
        },
        context: {
            includeDeclaration: false,
        }
    }).then((result) => {
        check(done, () => {
            chai.expect(result.length).to.equal(expected);
        });
    }, (err) => {
        return done(err || new Error('references request failed'));
    });
}
exports.references = references;
function workspaceReferences(params, expected, done) {
    channel.clientConnection.sendRequest(rt.WorkspaceReferenceRequest.type, params).then((result) => {
        check(done, () => {
            chai.expect(result).to.deep.equal(expected);
        });
    }, (err) => {
        return done(err || new Error('references request failed'));
    });
}
exports.workspaceReferences = workspaceReferences;
function symbols(params, expected, done) {
    channel.clientConnection.sendRequest(rt.WorkspaceSymbolsRequest.type, params).then((result) => {
        check(done, () => {
            chai.expect(result).to.deep.equal(expected);
        });
    }, (err) => {
        return done(err || new Error('workspace/symbol request failed'));
    });
}
exports.symbols = symbols;
function documentSymbols(params, expected, done) {
    channel.clientConnection.sendRequest(rt.DocumentSymbolRequest.type, params).then((result) => {
        check(done, () => {
            chai.expect(result).to.deep.equal(expected);
        });
    }, (err) => {
        return done(err || new Error('textDocument/documentSymbol request failed'));
    });
}
exports.documentSymbols = documentSymbols;
function open(uri, text) {
    channel.clientConnection.sendNotification(rt.TextDocumentDidOpenNotification.type, {
        textDocument: {
            uri: uri,
            languageId: "",
            version: 0,
            text: text
        }
    });
}
exports.open = open;
function close(uri) {
    channel.clientConnection.sendNotification(rt.TextDocumentDidCloseNotification.type, {
        textDocument: {
            uri: uri,
        }
    });
}
exports.close = close;
function change(uri, text) {
    channel.clientConnection.sendNotification(rt.TextDocumentDidChangeNotification.type, {
        textDocument: {
            uri: uri,
            version: 0,
        }, contentChanges: [{
                text: text
            }]
    });
}
exports.change = change;
//# sourceMappingURL=test-utils.js.map