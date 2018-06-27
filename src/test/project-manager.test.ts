import * as chai from 'chai'
import chaiAsPromised = require('chai-as-promised')
import { FileSystemUpdater } from '../fs'
import { OverlayFileSystem } from '../memfs'
import { ProjectManager } from '../project-manager'
import { uri2path } from '../util'
import { AddFileSystem, MapFileSystem } from './fs-helpers'
chai.use(chaiAsPromised)
const assert = chai.assert

describe('ProjectManager', () => {
    for (const rootUri of ['file:///', 
    //'file:///c:/foo/bar/', 
    'file:///foo/bar/'
]) {
        describe(`with rootUri ${rootUri}`, () => {
            let projectManager: ProjectManager
            let memfs: OverlayFileSystem
            it('should add a ProjectConfiguration when a tsconfig.json is added to the InMemoryFileSystem', async () => {
                const remoteFileSystem = new AddFileSystem()

                const rootPath = uri2path(rootUri)
                const configFileUri = rootUri + 'tsconfig.json'
                memfs = new OverlayFileSystem(remoteFileSystem, rootPath)
                const updater = new FileSystemUpdater(remoteFileSystem)
                const structureFetched = updater.fetchStructure().toPromise()
                projectManager = new ProjectManager(rootPath, memfs, updater, true)
                remoteFileSystem.addRemoteFile(configFileUri, '{}')
                remoteFileSystem.finishAddingFiles()
                await structureFetched

                const tsConfig = projectManager.getConfiguration(uri2path(rootUri + 'src/foo.ts'))
                const expectedConfigFilePath = uri2path(configFileUri)

                assert.equal(tsConfig.configFilePath, expectedConfigFilePath)
            })

            describe('ensureBasicFiles', () => {
                beforeEach(async () => {
                    const rootPath = uri2path(rootUri)
                    const localfs = new MapFileSystem(
                        new Map([
                            [rootUri + 'project/package.json', '{"name": "package-name-1"}'],
                            [rootUri + 'project/tsconfig.json', '{ "compilerOptions": { "typeRoots": ["../types"]} }'],
                            [
                                rootUri + 'project/node_modules/%40types/mocha/index.d.ts',
                                'declare var describe { (description: string, spec: () => void): void; }',
                            ],
                            [rootUri + 'project/file.ts', 'describe("test", () => console.log(GLOBALCONSTANT));'],
                            [rootUri + 'types/types.d.ts', 'declare var GLOBALCONSTANT=1;'],
                        ])
                    )
                    memfs = new OverlayFileSystem(localfs, rootPath)
                    const updater = new FileSystemUpdater(localfs)
                    projectManager = new ProjectManager(rootPath, memfs, updater, true)
                })

                it('loads files from typeRoots', async () => {
                    const sourceFileUri = rootUri + 'project/file.ts'
                    const typeRootFileUri = rootUri + 'types/types.d.ts'
                    await projectManager.ensureReferencedFiles(sourceFileUri).toPromise()
                    memfs.getContent(typeRootFileUri)

                    const config = projectManager.getConfiguration(uri2path(sourceFileUri), 'ts')
                    const host = config.getHost()
                    const typeDeclarationPath = uri2path(typeRootFileUri)
                    assert.includeMembers(host.getScriptFileNames(), [typeDeclarationPath])
                })

                it('loads mocha global type declarations', async () => {
                    const sourceFileUri = rootUri + 'project/file.ts'
                    const mochaDeclarationFileUri = rootUri + 'project/node_modules/%40types/mocha/index.d.ts'
                    await projectManager.ensureReferencedFiles(sourceFileUri).toPromise()
                    memfs.getContent(mochaDeclarationFileUri)

                    const config = projectManager.getConfiguration(uri2path(sourceFileUri), 'ts')
                    const host = config.getHost()
                    const mochaFilePath = uri2path(mochaDeclarationFileUri)
                    assert.includeMembers(host.getScriptFileNames(), [mochaFilePath])
                })
            })

            describe('getPackageName()', () => {
                beforeEach(async () => {
                    const rootPath = uri2path(rootUri)
                    const localfs = new MapFileSystem(
                        new Map([
                            [rootUri + 'package.json', '{"name": "package-name-1"}'],
                            [rootUri + 'subdirectory-with-tsconfig/package.json', '{"name": "package-name-2"}'],
                            [rootUri + 'subdirectory-with-tsconfig/src/tsconfig.json', '{}'],
                            [rootUri + 'subdirectory-with-tsconfig/src/dummy.ts', ''],
                        ])
                    )
                    memfs = new OverlayFileSystem(localfs, rootPath)
                    const updater = new FileSystemUpdater(localfs)
                    projectManager = new ProjectManager(rootPath, memfs, updater, true)
                    await projectManager.ensureAllFiles().toPromise()
                })
            })

            describe('ensureReferencedFiles()', () => {
                beforeEach(() => {
                    const rootPath = uri2path(rootUri)
                    const localfs = new MapFileSystem(
                        new Map([
                            [rootUri + 'package.json', '{"name": "package-name-1"}'],
                            [
                                rootUri + 'node_modules/somelib/index.js',
                                '/// <reference path="./pathref.d.ts"/>\n/// <reference types="node"/>',
                            ],
                            [rootUri + 'node_modules/somelib/pathref.d.ts', ''],
                            [rootUri + 'node_modules/%40types/node/index.d.ts', ''],
                            [rootUri + 'src/dummy.ts', 'import * as somelib from "somelib";'],
                        ])
                    )
                    memfs = new OverlayFileSystem(localfs, rootPath)
                    const updater = new FileSystemUpdater(localfs)
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
                    const localfs = new MapFileSystem(
                        new Map([[rootUri + 'tsconfig.json', '{}'], [rootUri + 'src/jsconfig.json', '{}']])
                    )
                    memfs = new OverlayFileSystem(localfs, rootPath)
                    const updater = new FileSystemUpdater(localfs)
                    projectManager = new ProjectManager(rootPath, memfs, updater, true)
                    await projectManager.ensureAllFiles().toPromise()
                })
                it('should resolve best configuration based on file name', () => {
                    const jsConfig = projectManager.getConfiguration(uri2path(rootUri + 'src/foo.js'))
                    const tsConfig = projectManager.getConfiguration(uri2path(rootUri + 'src/foo.ts'))
                    assert.equal(tsConfig.configFilePath, uri2path(rootUri + 'tsconfig.json'))
                    assert.equal(jsConfig.configFilePath, uri2path(rootUri + 'src/jsconfig.json'))
                    assert.equal(Array.from(projectManager.configurations()).length, 2)
                })
            })
            describe('getParentConfiguration()', () => {
                beforeEach(async () => {
                    const rootPath = uri2path(rootUri)
                    const localfs = new MapFileSystem(
                        new Map([[rootUri + 'tsconfig.json', '{}'], [rootUri + 'src/jsconfig.json', '{}']])
                    )
                    memfs = new OverlayFileSystem(localfs, rootPath)
                    const updater = new FileSystemUpdater(localfs)
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
                    const localfs = new MapFileSystem(
                        new Map([
                            [rootUri + 'tsconfig.json', '{}'],
                            [rootUri + 'foo/bar/tsconfig.json', '{}'],
                            [rootUri + 'foo/baz/jsconfig.json', '{}'],
                            [rootUri + 'foo/baz/fsconfig.json', '{}'],
                        ])
                    )
                    memfs = new OverlayFileSystem(localfs, rootPath)
                    const updater = new FileSystemUpdater(localfs)
                    projectManager = new ProjectManager(rootPath, memfs, updater, true)
                    await projectManager.ensureAllFiles().toPromise()
                })
                it('should resolve best configuration based on file name', () => {
                    const configs = Array.from(projectManager.getChildConfigurations(rootUri + 'foo')).map(
                        config => config.configFilePath
                    )
                    assert.deepEqual(configs, [
                        uri2path(rootUri + 'foo/bar/tsconfig.json'),
                        uri2path(rootUri + 'foo/baz/jsconfig.json'),
                    ])
                    assert.equal(Array.from(projectManager.configurations()).length, 3)
                })
            })
        })
    }
})
