import * as chai from 'chai';
import iterate from 'iterare';
import { InMemoryFileSystem, typeScriptLibraries } from '../memfs';
import { uri2path } from '../util';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('memfs.ts', () => {
	describe('InMemoryFileSystem', () => {
		describe('uris()', () => {
			it('should hide TypeScript library files', async () => {
				const fs = new InMemoryFileSystem('file:///', '/');
				assert.isFalse(iterate(fs.uris()).some(uri => typeScriptLibraries.has(uri2path(uri))));
			});
		});
		describe('fileExists()', () => {
			it('should expose TypeScript library files', async () => {
				const fs = new InMemoryFileSystem('file:///', '/');
				assert.isTrue(iterate(typeScriptLibraries.keys()).every(path => fs.fileExists(path)));
			});
		});
		describe('readFile()', () => {
			it('should expose TypeScript library files', async () => {
				const fs = new InMemoryFileSystem('file:///', '/');
				assert.isTrue(iterate(typeScriptLibraries.keys()).every(path => !!fs.readFile(path)));
			});
		});
	});
});
