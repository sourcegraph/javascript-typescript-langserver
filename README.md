# JavaScript/TypeScript language server

This is a language server for JavaScript and TypeScript that adheres to the [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol/blob/master/protocol.md). It uses [TypeScript's](http://www.typescriptlang.org/) LanguageService to perform source code analysis.

## Getting started

1. `npm install`
1. `node_modules/.bin/tsc`
1. `node build/language-server.js`

To try it in [Visual Studio Code](https://code.visualstudio.com), install the [vscode-client](https://github.com/sourcegraph/langserver/tree/master/vscode-client) extension and then open up a `.ts` file.

## Development

Run `node_modules/.bin/tsc --watch`.

## Command line arguments 

* `-p, --port` specifies port to use, default one is `2089`
* `-s, --strict` enables strict mode where server expects all files to be receives in `didOpen` notification requests.

## Known issues

* You need to disable VSCode's built-in TypeScript support to avoid weird conflicts on TypeScript files (double hover tooltips, etc.). There's a hacky way to do this: add the setting `{"typescript.tsdk": "/dev/null"}` to your VSCode user or workspace settings.

