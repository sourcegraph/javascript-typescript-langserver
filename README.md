# JavaScript/TypeScript language server

[![npm](https://img.shields.io/npm/v/javascript-typescript-langserver.svg)](https://www.npmjs.com/package/javascript-typescript-langserver)
[![npm](https://img.shields.io/npm/dm/javascript-typescript-langserver.svg)](https://www.npmjs.com/package/javascript-typescript-langserver)
[![Build Status](https://travis-ci.org/sourcegraph/javascript-typescript-langserver.svg?branch=master)](https://travis-ci.org/sourcegraph/javascript-typescript-langserver)
[![Windows Build Status](https://ci.appveyor.com/api/projects/status/2wj7xe035pm7r76v?svg=true)](https://ci.appveyor.com/project/sourcegraph/javascript-typescript-langserver/branch/master)
[![codecov](https://codecov.io/gh/sourcegraph/javascript-typescript-langserver/branch/master/graph/badge.svg)](https://codecov.io/gh/sourcegraph/javascript-typescript-langserver)
[![Dependencies](https://david-dm.org/sourcegraph/javascript-typescript-langserver.svg)](https://david-dm.org/sourcegraph/javascript-typescript-langserver)
[![Gitter](https://badges.gitter.im/sourcegraph/javascript-typescript-langserver.svg)](https://gitter.im/sourcegraph/javascript-typescript-langserver?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge)

This is a language server for JavaScript and TypeScript that adheres to the [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol/blob/master/protocol.md). It uses [TypeScript's](http://www.typescriptlang.org/) LanguageService to perform source code analysis.

## Getting started

1. `npm install`
1. `npm run build`
1. `node lib/language-server.js`

To try it in [Visual Studio Code](https://code.visualstudio.com), install the [vscode-client](https://github.com/sourcegraph/langserver/tree/master/vscode-client) extension and then open up a `.ts` file.

## Development

Run `npm run watch`.

## Tests

Run `npm test`.

## Command line arguments 

* `-p, --port` specifies port to use, default one is `2089`
* `-s, --strict` enables strict mode where server expects all files to be receives in `didOpen` notification requests
* `-c, --cluster` specifies number of concurrent cluster workers (defaults to number of CPUs)
* `-t, --trace` enables printing of all incoming and outgoing messages
* `-l, --logfile` specifies additional log file to print all messages to

## Supported LSP requests

### `initialize`
In strict mode we expect `rootPath` to be equal `file:///` while in non-strict mode VSCode usually sends absolute file URL. In both modes does not track existence of calling process.
### `exit`
Implementation closes underlying communication channel
### `shutdown`
Does nothing opposite to LSP specification that expects server to exit
### `textDocument/hover`
### `textDocument/definition`
### `textDocument/references`
### `workspace/symbols`
Introduces `limit` parameter to limit number of symbols to return

## Differences from LSP protocol specification
In strict mode LSP server does not touch underlying file system, instead it uses the [LSP files extension](https://github.com/sourcegraph/language-server-protocol/blob/master/extension-files.md) to retrieve workspace files and file contents.

## Known issues

* You need to disable VSCode's built-in TypeScript support to avoid weird conflicts on TypeScript files (double hover tooltips, etc.). There's a hacky way to do this: add the setting `{"typescript.tsdk": "/dev/null"}` to your VSCode user or workspace settings.

