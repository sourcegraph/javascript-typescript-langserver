# JavaScript/TypeScript language server

[![npm](https://img.shields.io/npm/v/javascript-typescript-langserver.svg)](https://www.npmjs.com/package/javascript-typescript-langserver)
[![npm](https://img.shields.io/npm/dm/javascript-typescript-langserver.svg)](https://www.npmjs.com/package/javascript-typescript-langserver)
[![Build Status](https://travis-ci.org/sourcegraph/javascript-typescript-langserver.svg?branch=master)](https://travis-ci.org/sourcegraph/javascript-typescript-langserver)
[![Windows Build Status](https://ci.appveyor.com/api/projects/status/2wj7xe035pm7r76v/branch/master?svg=true
)](https://ci.appveyor.com/project/sourcegraph/javascript-typescript-langserver/branch/master)
[![codecov](https://codecov.io/gh/sourcegraph/javascript-typescript-langserver/branch/master/graph/badge.svg)](https://codecov.io/gh/sourcegraph/javascript-typescript-langserver)
[![Dependencies](https://david-dm.org/sourcegraph/javascript-typescript-langserver.svg)](https://david-dm.org/sourcegraph/javascript-typescript-langserver)
[![OpenTracing Badge](https://img.shields.io/badge/OpenTracing-enabled-blue.svg)](http://opentracing.io)
[![Gitter](https://badges.gitter.im/sourcegraph/javascript-typescript-langserver.svg)](https://gitter.im/sourcegraph/javascript-typescript-langserver?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge)

This is a language server for JavaScript and TypeScript that adheres to the [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol/blob/master/protocol.md). It uses [TypeScript's](http://www.typescriptlang.org/) LanguageService to perform source code analysis.


## Try it out

 - On [sourcegraph.com](https://sourcegraph.com/github.com/sourcegraph/javascript-typescript-langserver/-/blob/src/typescript-service.ts)
 - In [Visual Studio Code](https://github.com/sourcegraph/vscode-javascript-typescript) (as an alternative to the built-in TypeScript integration)
 - In [Eclipse Che](https://eclipse.org/che/)
 - In [NeoVim](https://github.com/autozimu/LanguageClient-neovim)

## Features

 - Hovers
 - Goto definition
 - Find all references
 - Document symbols
 - Workspace symbol search
 - Rename
 - Completion
 - Signature help
 - Diagnostics
 - Quick fixes

## Run it from source

```bash
# install dependencies
npm install

# compile
npm run build
# or compile on file changes
npm run watch

# run over STDIO
node lib/language-server-stdio
# or run over TCP
node lib/language-server

# run tests
npm test
```

## Options

```
  Usage: language-server [options]

  Options:

    -h, --help            output usage information
    -V, --version         output the version number
    -s, --strict          enabled strict mode
    -p, --port [port]     specifies LSP port to use (2089)
    -c, --cluster [num]   number of concurrent cluster workers (defaults to number of CPUs, 8)
    -t, --trace           print all requests and responses
    -l, --logfile [file]  log to this file
```

## Extensions

This language server implements some LSP extensions, prefixed with an `x`.

- **[Files extension](https://github.com/sourcegraph/language-server-protocol/blob/master/extension-files.md)**  
  Allows the server to request file contents without accessing the file system
- **[SymbolDescriptor extension](https://github.com/sourcegraph/language-server-protocol/blob/master/extension-workspace-references.md)**  
  Get a SymbolDescriptor for a symbol, search the workspace for symbols or references to it
- **[Streaming](https://github.com/sourcegraph/language-server-protocol/blob/streaming/protocol.md#partialResult)**  
  Supports streaming partial results for all endpoints through JSON Patches
- **Packages extension**  
  Methods to get information about dependencies
- **TCP / multiple client support**  
  When running over TCP, the `exit` notification will not kill the process, but close the TCP socket

## Versioning

This project follows [semver](http://semver.org/) for command line arguments and standard LSP methods.
Any change to command line arguments, Node version or protocol breaking changes will result in a major version increase.
