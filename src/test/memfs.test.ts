import * as chai from 'chai'
import chaiAsPromised = require('chai-as-promised')
import iterate from 'iterare'
import { OverlayFileSystem, typeScriptLibraries } from '../memfs'
import { uri2path } from '../util'
import { MapFileSystem } from './fs-helpers'
chai.use(chaiAsPromised)
const assert = chai.assert

describe('memfs.ts', () => {
    describe('InMemoryFileSystem', () => {
        describe('uris()', () => {
            it('should hide TypeScript library files', async () => {
                const fs = new OverlayFileSystem(new MapFileSystem(), '/')
                assert.isFalse(iterate(fs.knownUrisWithoutAvailableContent()).some(uri => typeScriptLibraries.has(uri2path(uri))))
            })
        })
        describe('fileExists()', () => {
            it('should expose TypeScript library files', async () => {
                const fs = new OverlayFileSystem(new MapFileSystem(), '/')
                assert.isTrue(iterate(typeScriptLibraries.keys()).every(path => fs.fileExists(path)))
            })
        })
        describe('readFile()', () => {
            it('should expose TypeScript library files', async () => {
                const fs = new OverlayFileSystem(new MapFileSystem(), '/')
                assert.isTrue(iterate(typeScriptLibraries.keys()).every(path => !!fs.readFile(path)))
            })
        })
    })
})
