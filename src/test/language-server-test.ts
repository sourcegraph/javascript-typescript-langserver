import * as net from 'net';
import * as os from 'os';
import * as fs from 'fs';

import * as tmp from 'tmp';
import * as mocha from 'mocha';
import * as chai from 'chai';

import * as vscode from 'vscode-languageserver';

import Connection from '../connection';
import { FileInfo } from '../fs';
import * as rt from '../request-type';
import * as utils from './test-utils';

describe('LSP', function () {

    describe('definitions and hovers', function () {
        before(function (done: () => void) {
            utils.setUp({
                'a.ts': "const abc = 1; console.log(abc);",
                'foo': {
                    'b.ts': "/* This is class Foo */\nexport class Foo {}",
                    'c.ts': "import {Foo} from './b';",
                }
            }, done);
        });
        it('definition in same file', function (done: (err?: Error) => void) {
            utils.definition({
                textDocument: {
                    uri: 'file:///a.ts'
                },
                position: {
                    line: 0,
                    character: 29
                }
            }, {
                    uri: 'file:///a.ts',
                    range: {
                        start: {
                            line: 0,
                            character: 6
                        },
                        end: {
                            line: 0,
                            character: 13
                        }
                    }
                }, done);
        });
        it('hover in same file', function (done: (err?: Error) => void) {
            utils.hover({
                textDocument: {
                    uri: 'file:///a.ts'
                },
                position: {
                    line: 0,
                    character: 29
                }
            }, {
                    contents: [{
                        language: 'typescript',
                        value: 'const abc: number'
                    }]
                }, done);
        });
        it('definition in other file', function (done: (err?: Error) => void) {
            utils.definition({
                textDocument: {
                    uri: 'file:///foo/c.ts'
                },
                position: {
                    line: 0,
                    character: 9
                }
            }, {
                    uri: 'file:///foo/b.ts',
                    range: {
                        start: {
                            line: 1,
                            character: 0
                        },
                        end: {
                            line: 1,
                            character: 19
                        }
                    }
                }, done);
        });
        it('hover in other file', function (done: (err?: Error) => void) {
            utils.hover({
                textDocument: {
                    uri: 'file:///foo/c.ts'
                },
                position: {
                    line: 0,
                    character: 9
                }
            }, {
                    contents: [{
                        language: 'typescript',
                        value: 'import Foo'
                    }]
                }, done);
        });
        afterEach(function (done: () => void) {
            utils.tearDown(done);
        });
    });
    describe('js-project-no-config', function () {
        before(function (done: () => void) {
            utils.setUp({
                'a.js': "module.exports = {foo: function() {}}",
                'foo': {
                    'b.js': "var a = require('../a.js'); a.foo();",
                    'c.js': "var a = require('../a.js'); a.foo();",
                }
            }, done);
        });
        it('references', function (done: (err?: Error) => void) {
            utils.references({
                textDocument: {
                    uri: 'file:///a.js'
                },
                position: {
                    line: 0,
                    character: 20
                }
            }, 3, done);
        });
        afterEach(function (done: () => void) {
            utils.tearDown(done);
        });
    });
    describe('workspace symbols', function () {
        before(function (done: () => void) {
            utils.setUp({
                'a.ts': "class a { foo() { const i = 1;} }",
                'foo': {
                    'b.ts': "class b { bar: number; baz(): number { return this.bar;}}; function qux() {}"
                }
            }, done);
        });
        it('workspace symbols with empty query', function (done: (err?: Error) => void) {
            utils.symbols({
                query: '',
                limit: 3
            }, [
                    {
                        "kind": 5,
                        "location": {
                            "range": {
                                "end": {
                                    "character": 33,
                                    "line": 0
                                },
                                "start": {
                                    "character": 0,
                                    "line": 0
                                }
                            },
                            "uri": "file:////a.ts"
                        },
                        "name": "a"
                    },
                    {
                        "containerName": "a",
                        "kind": 6,
                        "location": {
                            "range": {
                                "end": {
                                    "character": 31,
                                    "line": 0
                                },
                                "start": {
                                    "character": 10,
                                    "line": 0
                                }
                            },
                            "uri": "file:////a.ts"
                        },
                        "name": "foo"
                    },
                    {
                        "containerName": "foo",
                        "kind": 15,
                        "location": {
                            "range": {
                                "end": {
                                    "character": 29,
                                    "line": 0
                                },
                                "start": {
                                    "character": 24,
                                    "line": 0
                                }
                            },
                            "uri": "file:////a.ts"
                        },
                        "name": "i"
                    }
                ]
                , done);
        });
        it('workspace symbols with not-empty query', function (done: (err?: Error) => void) {
            utils.symbols({
                query: 'ba',
                limit: 100
            }, [
                    {
                        "containerName": "b",
                        "kind": 7,
                        "location": {
                            "range": {
                                "end": {
                                    "character": 22,
                                    "line": 0
                                },
                                "start": {
                                    "character": 10,
                                    "line": 0
                                },
                            },
                            "uri": "file:////foo/b.ts"
                        },
                        "name": "bar"
                    },
                    {
                        "containerName": "b",
                        "kind": 6,
                        "location": {
                            "range": {
                                "end": {
                                    "character": 56,
                                    "line": 0
                                },
                                "start": {
                                    "character": 23,
                                    "line": 0
                                }
                            },
                            "uri": "file:////foo/b.ts"
                        },
                        "name": "baz"
                    }
                ]

                , done);
        });
        afterEach(function (done: () => void) {
            utils.tearDown(done);
        });
    });
});