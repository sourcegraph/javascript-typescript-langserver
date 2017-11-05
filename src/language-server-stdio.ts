#!/usr/bin/env node

import { Tracer } from 'opentracing'
import { isNotificationMessage } from 'vscode-jsonrpc/lib/messages'
import {
    MessageEmitter,
    MessageLogOptions,
    MessageWriter,
    registerLanguageHandler,
    RegisterLanguageHandlerOptions,
} from './connection'
import { RemoteLanguageClient } from './lang-handler'
import { FileLogger, StderrLogger } from './logging'
import { TypeScriptService, TypeScriptServiceOptions } from './typescript-service'

const packageJson = require('../package.json')
const program = require('commander')
const { initTracer } = require('jaeger-client')

program
    .version(packageJson.version)
    .option('-s, --strict', 'enables strict mode')
    .option('-t, --trace', 'print all requests and responses')
    .option('-l, --logfile [file]', 'log to this file')
    .option('-j, --enable-jaeger', 'enable OpenTracing through Jaeger')
    .parse(process.argv)

const logger = program.logfile ? new FileLogger(program.logfile) : new StderrLogger()
const tracer = program.enableJaeger
    ? initTracer({ serviceName: 'javascript-typescript-langserver', sampler: { type: 'const', param: 1 } })
    : new Tracer()

const options: TypeScriptServiceOptions & MessageLogOptions & RegisterLanguageHandlerOptions = {
    strict: program.strict,
    logMessages: program.trace,
    logger,
    tracer,
}

const messageEmitter = new MessageEmitter(process.stdin, options)
const messageWriter = new MessageWriter(process.stdout, options)
const remoteClient = new RemoteLanguageClient(messageEmitter, messageWriter)
const service = new TypeScriptService(remoteClient, options)

// Add an exit notification handler to kill the process
messageEmitter.on('message', message => {
    if (isNotificationMessage(message) && message.method === 'exit') {
        logger.log(`Exit notification`)
        process.exit(0)
    }
})

registerLanguageHandler(messageEmitter, messageWriter, service, options)
