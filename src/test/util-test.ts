import * as assert from 'assert'
import {
    getMatchingPropertyCount,
    getPropertyCount,
    isGlobalTSFile,
    isSymbolDescriptorMatch,
    JSONPTR,
    path2uri,
    uri2path,
} from '../util'

describe('util', () => {
    describe('JSONPTR', () => {
        it('should escape JSON Pointer components', () => {
            const uri = 'file:///foo/~bar'
            const pointer = JSONPTR`/changes/${uri}/-`
            assert.equal(pointer, '/changes/file:~1~1~1foo~1~0bar/-')
        })
    })
    describe('getMatchingPropertyCount()', () => {
        it('should return a score of 4 if 4 properties match', () => {
            const score = getMatchingPropertyCount(
                {
                    containerName: 'ts',
                    kind: 'interface',
                    name: 'Program',
                    package: undefined,
                },
                {
                    containerKind: 'module',
                    containerName: 'ts',
                    kind: 'interface',
                    name: 'Program',
                    package: undefined,
                }
            )
            assert.equal(score, 4)
        })
        it('should return a score of 0.6 if a string property is 60% similar', () => {
            const score = getMatchingPropertyCount(
                {
                    filePath: 'lib/foo.d.ts',
                },
                {
                    filePath: 'src/foo.ts',
                }
            )
            assert.equal(score, 0.6)
        })
        it('should return a score of 4 if 4 properties match and 1 does not', () => {
            const score = getMatchingPropertyCount(
                {
                    containerKind: '',
                    containerName: 'util',
                    kind: 'var',
                    name: 'colors',
                    package: undefined,
                },
                {
                    containerKind: '',
                    containerName: '',
                    kind: 'var',
                    name: 'colors',
                    package: undefined,
                }
            )
            assert.equal(score, 4)
        })
        it('should return a score of 3 if 3 properties match deeply', () => {
            const score = getMatchingPropertyCount(
                {
                    name: 'a',
                    kind: 'class',
                    package: { name: 'mypkg' },
                    containerKind: undefined,
                },
                {
                    kind: 'class',
                    name: 'a',
                    containerKind: '',
                    containerName: '',
                    package: { name: 'mypkg' },
                }
            )
            assert.equal(score, 3)
        })
    })
    describe('getPropertyCount()', () => {
        it('should return the amount of leaf properties', () => {
            const count = getPropertyCount({
                name: 'a', // 1
                kind: 'class', // 2
                package: {
                    name: 'mypkg', // 3
                },
                containerKind: '', // 4
            })
            assert.equal(count, 4)
        })
    })
    describe('isSymbolDescriptorMatch()', () => {
        it('should return true for a matching query', () => {
            const matches = isSymbolDescriptorMatch(
                {
                    containerKind: undefined,
                    containerName: 'ts',
                    kind: 'interface',
                    name: 'Program',
                    filePath: 'foo/bar.ts',
                    package: undefined,
                },
                {
                    containerKind: 'module',
                    containerName: 'ts',
                    kind: 'interface',
                    name: 'Program',
                    filePath: 'foo/bar.ts',
                    package: undefined,
                }
            )
            assert.equal(matches, true)
        })
        it('should return true for a matching query with PackageDescriptor', () => {
            const matches = isSymbolDescriptorMatch(
                {
                    name: 'a',
                    kind: 'class',
                    package: { name: 'mypkg' },
                    filePath: 'foo/bar.ts',
                    containerKind: undefined,
                },
                {
                    kind: 'class',
                    name: 'a',
                    containerKind: '',
                    containerName: '',
                    filePath: 'foo/bar.ts',
                    package: { name: 'mypkg' },
                }
            )
            assert.equal(matches, true)
        })
    })
    describe('isGlobalTSFile()', () => {
        it('should match the synthetic reference to tsdlib when using importHelpers', () => {
            assert.equal(isGlobalTSFile('/node_modules/tslib/tslib.d.ts'), true)
        })
        it('should not include non-declaration files', () => {
            assert.equal(isGlobalTSFile('/node_modules/@types/node/Readme.MD'), false)
        })
        it('should include some libraries from @types with global declarations', () => {
            assert.equal(isGlobalTSFile('/node_modules/@types/node/index.d.ts'), true)
            assert.equal(isGlobalTSFile('/node_modules/@types/jest/index.d.ts'), true)
            assert.equal(isGlobalTSFile('/node_modules/@types/jasmine/index.d.ts'), true)
            assert.equal(isGlobalTSFile('/node_modules/@types/mocha/index.d.ts'), true)
        })
    })
    describe('path2uri()', () => {
        it('should throw an error if a non-absolute uri is passed in', () => {
            assert.throws(() => path2uri('baz/qux'))
        })
        it('should convert a Unix file path to a URI', () => {
            const uri = path2uri('/baz/qux')
            assert.equal(uri, 'file:///baz/qux')
        })
        it('should convert a Windows file path to a URI', () => {
            const uri = path2uri('C:\\baz\\qux')
            assert.equal(uri, 'file:///C:/baz/qux')
        })
        it('should encode special characters', () => {
            const uri = path2uri('/💩')
            assert.equal(uri, 'file:///%F0%9F%92%A9')
        })
        it('should encode unreserved special characters', () => {
            const uri = path2uri('/@baz')
            assert.equal(uri, 'file:///%40baz')
        })
    })
    describe('uri2path()', () => {
        it('should convert a Unix file URI to a file path', () => {
            const filePath = uri2path('file:///baz/qux')
            assert.equal(filePath, '/baz/qux')
        })
        it('should convert a Windows file URI to a file path', () => {
            const filePath = uri2path('file:///c:/baz/qux')
            assert.equal(filePath, 'c:\\baz\\qux')
        })
        it('should convert a Windows file URI with uppercase drive letter to a file path', () => {
            const filePath = uri2path('file:///C:/baz/qux')
            assert.equal(filePath, 'C:\\baz\\qux')
        })
        it('should decode special characters', () => {
            const filePath = uri2path('file:///%F0%9F%92%A9')
            assert.equal(filePath, '/💩')
        })
        it('should decode unreserved special characters', () => {
            const filePath = uri2path('file:///%40foo')
            assert.equal(filePath, '/@foo')
        })
    })
})
