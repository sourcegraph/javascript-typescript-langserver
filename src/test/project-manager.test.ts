import * as chai from 'chai'
import chaiAsPromised = require('chai-as-promised')
import { FileSystemUpdater } from '../fs'
import { InMemoryFileSystem } from '../memfs'
import { ProjectManager } from '../project-manager'
import { uri2path } from '../util'
import { MapFileSystem } from './fs-helpers'
chai.use(chaiAsPromised)
const assert = chai.assert

describe('ProjectManager', () => {
    for (const rootUri of ['file:///', 'file:///c:/foo/bar/', 'file:///foo/bar/']) {
        testWithRootUri(rootUri)
    }
})

function testWithRootUri(rootUri: string): void {
    describe(`with rootUri ${rootUri}`, () => {

        let projectManager: ProjectManager
        let memfs: InMemoryFileSystem

        it('should add a ProjectConfiguration when a tsconfig.json is added to the InMemoryFileSystem', () => {
            const rootPath = uri2path(rootUri)
            memfs = new InMemoryFileSystem(rootPath)
            const configFileUri = rootUri + 'foo/tsconfig.json'
            const localfs = new MapFileSystem(new Map([
                [configFileUri, '{}']
            ]))
            const updater = new FileSystemUpdater(localfs, memfs)
            projectManager = new ProjectManager(rootPath, memfs, updater, true)
            memfs.add(configFileUri, '{}')
            const configs = Array.from(projectManager.configurations())
            const expectedConfigFilePath = uri2path(configFileUri)

            assert.isDefined(configs.find(config => config.configFilePath === expectedConfigFilePath))
        })

        describe('ensureBasicFiles', () => {
            beforeEach(async () => {
                const rootPath = uri2path(rootUri)
                memfs = new InMemoryFileSystem(rootPath)
                const localfs = new MapFileSystem(new Map([
                    [rootUri + 'project/package.json', '{"name": "package-name-1"}'],
                    [rootUri + 'project/tsconfig.json', '{ "compilerOptions": { "typeRoots": ["../types"]} }'],
                    [rootUri + 'project/file.ts', 'console.log(GLOBALCONSTANT);'],
                    [rootUri + 'types/types.d.ts', 'declare var GLOBALCONSTANT=1;']

                ]))
                const updater = new FileSystemUpdater(localfs, memfs)
                projectManager = new ProjectManager(rootPath, memfs, updater, true)
            })
            it('loads files from typeRoots', async () => {
                await projectManager.ensureReferencedFiles(rootUri + 'project/file.ts').toPromise()
                memfs.getContent(rootUri + 'project/file.ts')
                memfs.getContent(rootUri + 'types/types.d.ts')
            })
        })

        describe('getPackageName()', () => {
            beforeEach(async () => {
                const rootPath = uri2path(rootUri)
                memfs = new InMemoryFileSystem(rootPath)
                const localfs = new MapFileSystem(new Map([
                    [rootUri + 'package.json', '{"name": "package-name-1"}'],
                    [rootUri + 'subdirectory-with-tsconfig/package.json', '{"name": "package-name-2"}'],
                    [rootUri + 'subdirectory-with-tsconfig/src/tsconfig.json', '{}'],
                    [rootUri + 'subdirectory-with-tsconfig/src/dummy.ts', '']
                ]))
                const updater = new FileSystemUpdater(localfs, memfs)
                projectManager = new ProjectManager(rootPath, memfs, updater, true)
                await projectManager.ensureAllFiles().toPromise()
            })
        })

        describe('ensureReferencedFiles()', () => {
            beforeEach(() => {
                const rootPath = uri2path(rootUri)
                memfs = new InMemoryFileSystem(rootPath)
                const localfs = new MapFileSystem(new Map([
                    [rootUri + 'package.json', '{"name": "package-name-1"}'],
                    [rootUri + 'node_modules/somelib/index.js', '/// <reference path="./pathref.d.ts"/>\n/// <reference types="node"/>'],
                    [rootUri + 'node_modules/somelib/pathref.d.ts', ''],
                    [rootUri + 'node_modules/%40types/node/index.d.ts', ''],
                    [rootUri + 'src/dummy.ts', 'import * as somelib from "somelib";']
                ]))
                const updater = new FileSystemUpdater(localfs, memfs)
                projectManager = new ProjectManager(rootPath, memfs, updater, true)
            })
            it('should ensure content for imports and references is fetched', async () => {
                await projectManager.ensureReferencedFiles(rootUri + 'src/dummy.ts').toPromise()
                memfs.getContent(rootUri + 'node_modules/somelib/index.js')
                memfs.getContent(rootUri + 'node_modules/somelib/pathref.d.ts')
                memfs.getContent(rootUri + 'node_modules/%40types/node/index.d.ts')
            })
        })
        describe('getConfiguration()', () => {
            beforeEach(async () => {
                const rootPath = uri2path(rootUri)
                memfs = new InMemoryFileSystem(rootPath)
                const localfs = new MapFileSystem(new Map([
                    [rootUri + 'tsconfig.json', '{}'],
                    [rootUri + 'src/jsconfig.json', '{}']
                ]))
                const updater = new FileSystemUpdater(localfs, memfs)
                projectManager = new ProjectManager(rootPath, memfs, updater, true)
                await projectManager.ensureAllFiles().toPromise()
            })
            it('should resolve best configuration based on file name', () => {
                const jsConfig = projectManager.getConfiguration(uri2path(rootUri + 'src/foo.js'))
                const tsConfig = projectManager.getConfiguration(uri2path(rootUri + 'src/foo.ts'))
                assert.equal(uri2path(rootUri + 'tsconfig.json'), tsConfig.configFilePath)
                assert.equal(uri2path(rootUri + 'src/jsconfig.json'), jsConfig.configFilePath)
                assert.equal(Array.from(projectManager.configurations()).length, 2)
            })
        })
        describe('getParentConfiguration()', () => {
            beforeEach(async () => {
                const rootPath = uri2path(rootUri)
                memfs = new InMemoryFileSystem(rootPath)
                const localfs = new MapFileSystem(new Map([
                    [rootUri + 'tsconfig.json', '{}'],
                    [rootUri + 'src/jsconfig.json', '{}']
                ]))
                const updater = new FileSystemUpdater(localfs, memfs)
                projectManager = new ProjectManager(rootPath, memfs, updater, true)
                await projectManager.ensureAllFiles().toPromise()
            })
            it('should resolve best configuration based on file name', () => {
                const config = projectManager.getParentConfiguration(rootUri + 'src/foo.ts')
                assert.isDefined(config)
                assert.equal(uri2path(rootUri + 'tsconfig.json'), config!.configFilePath)
                assert.equal(Array.from(projectManager.configurations()).length, 2)
            })
        })
        describe('getChildConfigurations()', () => {
            beforeEach(async () => {
                const rootPath = uri2path(rootUri)
                memfs = new InMemoryFileSystem(rootPath)
                const localfs = new MapFileSystem(new Map([
                    [rootUri + 'tsconfig.json', '{}'],
                    [rootUri + 'foo/bar/tsconfig.json', '{}'],
                    [rootUri + 'foo/baz/tsconfig.json', '{}']
                ]))
                const updater = new FileSystemUpdater(localfs, memfs)
                projectManager = new ProjectManager(rootPath, memfs, updater, true)
                await projectManager.ensureAllFiles().toPromise()
            })
            it('should resolve best configuration based on file name', () => {
                const configs = Array.from(projectManager.getChildConfigurations(rootUri + 'foo')).map(config => config.configFilePath)
                assert.deepEqual(configs, [
                    uri2path(rootUri + 'foo/bar/tsconfig.json'),
                    uri2path(rootUri + 'foo/baz/tsconfig.json')
                ])
                assert.equal(Array.from(projectManager.configurations()).length, 4)
            })
        })
    })
}
