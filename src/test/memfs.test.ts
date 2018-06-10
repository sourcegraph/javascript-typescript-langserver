import * as chai from 'chai'
import chaiAsPromised = require('chai-as-promised')
import iterate from 'iterare'
import * as sinon from 'sinon'
import { InMemoryFileSystem, typeScriptLibraries } from '../memfs'
import { uri2path } from '../util'
chai.use(chaiAsPromised)
const assert = chai.assert

describe('memfs.ts', () => {
    describe('InMemoryFileSystem', () => {
        describe('add()', () => {
            it('should add just a URI and emit an event', () => {
                const listener = sinon.spy()
                const fs = new InMemoryFileSystem('/')
                fs.on('add', listener)
                fs.add('file:///foo/bar.txt')
                sinon.assert.calledOnce(listener)
                sinon.assert.calledWithExactly(listener, 'file:///foo/bar.txt', undefined)
            })
            it('should add just a URI and emit an event when URI has encoded char', () => {
                const listener = sinon.spy()
                const fs = new InMemoryFileSystem('/')
                fs.on('add', listener)
                fs.add('file:///foo/%25bar.txt')
                sinon.assert.calledOnce(listener)
                sinon.assert.calledWithExactly(listener, 'file:///foo/%25bar.txt', undefined)
            })
            it('should add content for a URI and emit an event', () => {
                const listener = sinon.spy()
                const fs = new InMemoryFileSystem('/')
                fs.on('add', listener)
                fs.add('file:///foo/bar.txt', 'hello world')
                sinon.assert.calledOnce(listener)
                sinon.assert.calledWithExactly(listener, 'file:///foo/bar.txt', 'hello world')
            })
        })
        describe('uris()', () => {
            it('should hide TypeScript library files', async () => {
                const fs = new InMemoryFileSystem('/')
                assert.isFalse(iterate(fs.uris()).some(uri => typeScriptLibraries.has(uri2path(uri))))
            })
        })
        describe('fileExists()', () => {
            it('should expose TypeScript library files', async () => {
                const fs = new InMemoryFileSystem('/')
                assert.isTrue(iterate(typeScriptLibraries.keys()).every(path => fs.fileExists(path)))
            })
        })
        describe('readFile()', () => {
            it('should expose TypeScript library files', async () => {
                const fs = new InMemoryFileSystem('/')
                assert.isTrue(iterate(typeScriptLibraries.keys()).every(path => !!fs.readFile(path)))
            })
        })
    })
})
