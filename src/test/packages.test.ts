import * as assert from 'assert'
import * as sinon from 'sinon'
import { FileSystemUpdater } from '../fs'
import { InMemoryFileSystem } from '../memfs'
import { extractDefinitelyTypedPackageName, extractNodeModulesPackageName, PackageManager } from '../packages'
import { MapFileSystem } from './fs-helpers'

describe('packages.ts', () => {
    describe('extractDefinitelyTypedPackageName()', () => {
        it('should return the @types package name for a file in DefinitelyTyped', () => {
            const packageName = extractDefinitelyTypedPackageName('file:///types/node/index.d.ts')
            assert.equal(packageName, '@types/node')
        })
        it('should return undefined otherwise', () => {
            const packageName = extractDefinitelyTypedPackageName('file:///package.json')
            assert.strictEqual(packageName, undefined)
        })
    })
    describe('extractNodeModulesPackageName()', () => {
        it('should return the package name for a file in node_modules', () => {
            const packageName = extractNodeModulesPackageName('file:///foo/node_modules/bar/baz/test.ts')
            assert.equal(packageName, 'bar')
        })
        it('should return the package name for a file in a scoped package in node_modules', () => {
            const packageName = extractNodeModulesPackageName('file:///foo/node_modules/@types/bar/baz/test.ts')
            assert.equal(packageName, '@types/bar')
        })
        it('should return the package name for a file in nested node_modules', () => {
            const packageName = extractNodeModulesPackageName('file:///foo/node_modules/bar/node_modules/baz/test.ts')
            assert.equal(packageName, 'baz')
        })
        it('should return undefined otherwise', () => {
            const packageName = extractNodeModulesPackageName('file:///foo/bar')
            assert.strictEqual(packageName, undefined)
        })
    })
    describe('PackageManager', () => {
        it('should register new packages as they are added to InMemoryFileSystem', () => {
            const memfs = new InMemoryFileSystem('/')
            const localfs = new MapFileSystem(new Map())
            const updater = new FileSystemUpdater(localfs, memfs)
            const packageManager = new PackageManager(updater, memfs)

            const listener = sinon.spy()
            packageManager.on('parsed', listener)

            memfs.add('file:///foo/package.json', '{}')

            sinon.assert.calledOnce(listener)
            sinon.assert.alwaysCalledWith(listener, 'file:///foo/package.json', {})

            const packages = Array.from(packageManager.packageJsonUris())
            assert.deepEqual(packages, ['file:///foo/package.json'])
        })
    })
})
