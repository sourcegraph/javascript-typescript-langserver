## ⚠️ This project is no longer maintained

This language server is an implementation of LSP using TypeScript's APIs.
This approach made it difficult to keep up with new features of TypeScript and implied that the server always uses a bundled TypeScript version, instead of the local TypeScript in `node_modules` like using the official (non-LSP) [`tsserver`](https://github.com/Microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29) allows.

On top of that, over time we simplified our architecture for running language servers in the cloud at Sourcegraph which removed the necessity for this level of tight integration and control. 
[Theia's TypeScript language server](https://github.com/theia-ide/typescript-language-server) is a thinner wrapper around `tsserver`, which avoids these problems to some extend.
[Our latest approach](https://github.com/sourcegraph/sourcegraph-typescript) of running a TypeScript language server in the cloud uses Theia's language server (and transitively `tsserver`) under the hood.

However, since then our code intelligence evolved even further and is nowadays powered primarily by [LSIF](https://lsif.dev/), the _Language Server Index Format_.
LSIF is developed together with LSP and uses the same structures, but in a pre-computed serialization instead of an RPC protocol.
This allows us to provide [near-instant code intelligence](https://docs.sourcegraph.com/user/code_intelligence/explanations/precise_code_intelligence) for our tricky on-demand cloud code intelligence scenarios and hence we are focusing all of our efforts on LSIF indexers.
All of this work is also open source of course and if you're curious you can read more about [how we use LSIF on our blog](https://about.sourcegraph.com/blog/evolution-of-the-precise-code-intel-backend/).

---------------------

# JavaScript/TypeScript language server

[![npm](https://img.shields.io/npm/v/javascript-typescript-langserver.svg)](https://www.npmjs.com/package/javascript-typescript-langserver)
[![downloads](https://img.shields.io/npm/dm/javascript-typescript-langserver.svg)](https://www.npmjs.com/package/javascript-typescript-langserver)
[![build](https://travis-ci.org/sourcegraph/javascript-typescript-langserver.svg?branch=master)](https://travis-ci.org/sourcegraph/javascript-typescript-langserver)
[![appveyor build](https://ci.appveyor.com/api/projects/status/2wj7xe035pm7r76v/branch/master?svg=true
)](https://ci.appveyor.com/project/sourcegraph/javascript-typescript-langserver/branch/master)
[![codecov](https://codecov.io/gh/sourcegraph/javascript-typescript-langserver/branch/master/graph/badge.svg)](https://codecov.io/gh/sourcegraph/javascript-typescript-langserver)
[![dependencies](https://david-dm.org/sourcegraph/javascript-typescript-langserver.svg)](https://david-dm.org/sourcegraph/javascript-typescript-langserver)
[![OpenTracing: enabled](https://img.shields.io/badge/OpenTracing-enabled-blue.svg)](http://opentracing.io)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![license](https://img.shields.io/github/license/sourcegraph/javascript-typescript-langserver.svg)]()
[![chat: on gitter](https://badges.gitter.im/sourcegraph/javascript-typescript-langserver.svg)](https://gitter.im/sourcegraph/javascript-typescript-langserver?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge)

This is a language server for JavaScript and TypeScript that adheres to the [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol/blob/master/protocol.md). It uses [TypeScript's](http://www.typescriptlang.org/) LanguageService to perform source code analysis.


## Try it out

 - On [sourcegraph.com](https://sourcegraph.com/github.com/sourcegraph/javascript-typescript-langserver/-/blob/src/typescript-service.ts)
 - In [Visual Studio Code](https://github.com/sourcegraph/vscode-javascript-typescript) (as an alternative to the built-in TypeScript integration)
 - In [Eclipse Che](https://eclipse.org/che/)
 - In [NeoVim](https://github.com/autozimu/LanguageClient-neovim)
 - In [Sublime Text](https://lsp.readthedocs.io/en/latest/#javascripttypescript)

## Features

 - Hovers
 - Goto definition
 - Goto type definition
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
    -j, --enable-jaeger   enable OpenTracing through Jaeger
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

## Debugging Performance with OpenTracing

The language server is fully traced through [OpenTracing](http://opentracing.io/), which allows to debug what exact operations caused method calls to take long.
You can pass a span context through an optional `meta` field on the JSON RPC message object.

For local development, there is built-in support for the open source OpenTracing implementation [Jaeger](http://jaeger.readthedocs.io/en/latest/), which can be set up to run on localhost with just one command (you need [Docker](https://www.docker.com/) installed):

```
docker run -d -p5775:5775/udp -p6831:6831/udp -p6832:6832/udp \
  -p5778:5778 -p16686:16686 -p14268:14268 jaegertracing/all-in-one:latest
```

After that, run the language server with the `--enable-jaeger` command line flag and do some requests from your client.
Open http://localhost:16686 in your browser and you will see method calls broken down into spans.
