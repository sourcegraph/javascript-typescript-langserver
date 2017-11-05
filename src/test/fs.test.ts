import * as chai from 'chai'
import chaiAsPromised = require('chai-as-promised')
import * as fs from 'mz/fs'
import * as path from 'path'
import * as rimraf from 'rimraf'
import * as temp from 'temp'
import { LocalFileSystem } from '../fs'
import { path2uri } from '../util'
chai.use(chaiAsPromised)
const assert = chai.assert

describe('fs.ts', () => {
    describe('LocalFileSystem', () => {
        let temporaryDir: string
        let fileSystem: LocalFileSystem
        let rootUri: string

        before(async () => {
            temporaryDir = await new Promise<string>((resolve, reject) => {
                temp.mkdir('local-fs', (err: Error, dirPath: string) => (err ? reject(err) : resolve(dirPath)))
            })

            // global packages contains a package
            const globalPackagesDir = path.join(temporaryDir, 'node_modules')
            await fs.mkdir(globalPackagesDir)
            const somePackageDir = path.join(globalPackagesDir, 'some_package')
            await fs.mkdir(somePackageDir)
            await fs.mkdir(path.join(somePackageDir, 'src'))
            await fs.writeFile(path.join(somePackageDir, 'src', 'function.ts'), 'foo')

            // the project dir
            const projectDir = path.join(temporaryDir, 'project')
            rootUri = path2uri(projectDir) + '/'
            await fs.mkdir(projectDir)
            await fs.mkdir(path.join(projectDir, 'foo'))
            await fs.mkdir(path.join(projectDir, '@types'))
            await fs.mkdir(path.join(projectDir, '@types', 'diff'))
            await fs.mkdir(path.join(projectDir, 'node_modules'))
            await fs.writeFile(path.join(projectDir, 'tweedledee'), 'hi')
            await fs.writeFile(path.join(projectDir, 'tweedledum'), 'bye')
            await fs.writeFile(path.join(projectDir, 'foo', 'bar.ts'), 'baz')
            await fs.writeFile(path.join(projectDir, '@types', 'diff', 'index.d.ts'), 'baz')

            // global package is symlinked into project using npm link
            await fs.symlink(somePackageDir, path.join(projectDir, 'node_modules', 'some_package'), 'junction')
            fileSystem = new LocalFileSystem(rootUri)
        })
        after(async () => {
            await new Promise<void>((resolve, reject) => {
                rimraf(temporaryDir, err => (err ? reject(err) : resolve()))
            })
        })

        describe('getWorkspaceFiles()', () => {
            it('should return all files in the workspace', async () => {
                const files = await fileSystem
                    .getWorkspaceFiles()
                    .toArray()
                    .toPromise()
                assert.sameMembers(files, [
                    rootUri + 'tweedledee',
                    rootUri + 'tweedledum',
                    rootUri + 'foo/bar.ts',
                    rootUri + '%40types/diff/index.d.ts',
                    rootUri + 'node_modules/some_package/src/function.ts',
                ])
            })
            it('should return all files under specific root', async () => {
                const files = await fileSystem
                    .getWorkspaceFiles(rootUri + 'foo')
                    .toArray()
                    .toPromise()
                assert.sameMembers(files, [rootUri + 'foo/bar.ts'])
            })
        })
        describe('getTextDocumentContent()', () => {
            it('should read files denoted by absolute URI', async () => {
                const content = await fileSystem.getTextDocumentContent(rootUri + 'tweedledee').toPromise()
                assert.equal(content, 'hi')
            })
        })
    })
})
