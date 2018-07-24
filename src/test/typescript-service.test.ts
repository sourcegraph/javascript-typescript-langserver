import * as fs from 'fs'
import * as path from 'path'
import * as rimraf from 'rimraf'
import * as temp from 'temp'
import { RemoteFileSystem } from '../fs'
import { TypeScriptService, TypeScriptServiceFactory } from '../typescript-service'
import { path2uri, uri2path } from '../util'
import { describeTypeScriptService } from './typescript-service-helpers'

function ensureDirectoryExistence(filePath: string): void {
    const dirname = path.dirname(filePath)
    if (fs.existsSync(dirname)) {
        return
    }
    ensureDirectoryExistence(dirname)
    fs.mkdirSync(dirname)
}

describe('TypeScriptService', async () => {
    for (const rootUri of ['file:///', 'file:///c:/foo/bar/', 'file:///foo/bar/']) {
        describe(`rootUri ${rootUri}`, () => {
            describeTypeScriptService({
                createService: async (client, options) => new TypeScriptService(client, options),
                clientCapabilities: {
                    xcontentProvider: true,
                    xfilesProvider: true,
                },
                rootUri,
            })
        })
    }

    const temporaryDir = temp.mkdirSync('local-fs') + '/'

    describe(`local filesystem`, () => {
        const createService: TypeScriptServiceFactory = async (client, options) => {
            const remoteFileSystem = new RemoteFileSystem(client)
            await new Promise<void>((resolve, reject) => {
                rimraf(temporaryDir, err => (err ? reject(err) : resolve()))
            })
            await remoteFileSystem
                .getWorkspaceFiles()
                .flatMap((fileUri: string) =>
                    remoteFileSystem.getTextDocumentContent(fileUri).map((content: string) => ({ fileUri, content }))
                )
                .do((fileContent: { fileUri: string; content: string }) => {
                    const fileName = uri2path(fileContent.fileUri)
                    ensureDirectoryExistence(fileName)
                    fs.writeFileSync(fileName, fileContent.content, 'utf8')
                })
                .toPromise()
            return new TypeScriptService(client, Object.assign({ strict: false }, options))
        }
        const options = { createService, clientCapabilities: {}, rootUri: path2uri(temporaryDir) }

        describeTypeScriptService(options)
    })

    after(async () => {
        await new Promise<void>((resolve, reject) => {
            rimraf(temporaryDir, err => (err ? reject(err) : resolve()))
        })
    })
})
