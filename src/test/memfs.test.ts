import * as chai from 'chai';
import iterate from 'iterare';
import { getTypeScriptLibraries, InMemoryFileSystem } from '../memfs';
import { uri2path } from '../util';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('memfs.ts', () => {
	describe('InMemoryFileSystem', () => {
		describe('uris()', () => {
			it('should hide TypeScript library files', async () => {
				const libraries = getTypeScriptLibraries();
				const fs = new InMemoryFileSystem('/');
				assert.isFalse(iterate(fs.uris()).some(uri => libraries.has(uri2path(uri))));
			});
		});
		describe('fileExists()', () => {
			it('should expose TypeScript library files', async () => {
				const libraries = getTypeScriptLibraries();
				const fs = new InMemoryFileSystem('/');
				assert.isTrue(iterate(libraries.keys()).every(path => fs.fileExists(path)));
			});
		});
		describe('readFile()', () => {
			it('should expose TypeScript library files', async () => {
				const libraries = getTypeScriptLibraries();
				const fs = new InMemoryFileSystem('/');
				assert.isTrue(iterate(libraries.keys()).every(path => !!fs.readFile(path)));
			});
		});
	});
});
