import * as chai from 'chai'
import chaiAsPromised = require('chai-as-promised')
import iterate from 'iterare'
import { InMemoryFileSystem } from '../fs'
import { OverlayFileSystem, typeScriptLibraries } from '../memfs'
chai.use(chaiAsPromised)
const assert = chai.assert

describe('memfs.ts', () => {
    describe('OverlayFileSystem', () => {
        describe('fileExists()', () => {
            it('should expose TypeScript library files', async () => {
                const fs = new OverlayFileSystem(new InMemoryFileSystem(), '/')
                assert.isTrue(iterate(typeScriptLibraries.keys()).every(path => fs.fileExists(path)))
            })
        })
        describe('readFile()', () => {
            it('should expose TypeScript library files', async () => {
                const fs = new OverlayFileSystem(new InMemoryFileSystem(), '/')
                assert.isTrue(iterate(typeScriptLibraries.keys()).every(path => !!fs.readFile(path)))
            })
        })
    })
})
