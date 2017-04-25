import * as chai from 'chai';
import iterate from 'iterare';
import * as fs from 'mz/fs';
import * as path from 'path';
import * as rimraf from 'rimraf';
import * as temp from 'temp';
import { URL } from 'whatwg-url';
import { LocalFileSystem } from '../fs';
import { path2uri } from '../util';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('fs.ts', () => {
	describe('LocalFileSystem', () => {
		let temporaryDir: string;
		let fileSystem: LocalFileSystem;
		let baseUri: URL;

		before(async () => {
			temporaryDir = await new Promise<string>((resolve, reject) => {
				temp.mkdir('local-fs', (err: Error, dirPath: string) => err ? reject(err) : resolve(dirPath));
			});
			baseUri = new URL(path2uri('', temporaryDir) + '/');
			await fs.mkdir(path.join(temporaryDir, 'foo'));
			await fs.mkdir(path.join(temporaryDir, '@types'));
			await fs.mkdir(path.join(temporaryDir, '@types', 'diff'));
			await fs.writeFile(path.join(temporaryDir, 'tweedledee'), 'hi');
			await fs.writeFile(path.join(temporaryDir, 'tweedledum'), 'bye');
			await fs.writeFile(path.join(temporaryDir, 'foo', 'bar.ts'), 'baz');
			await fs.writeFile(path.join(temporaryDir, '@types', 'diff', 'index.d.ts'), 'baz');
			fileSystem = new LocalFileSystem(baseUri);
		});
		after(async () => {
			await new Promise<void>((resolve, reject) => {
				rimraf(temporaryDir, err => err ? reject(err) : resolve());
			});
		});

		describe('getWorkspaceFiles()', () => {
			it('should return all files in the workspace', async () => {
				const files = iterate(await fileSystem.getWorkspaceFiles()).map(uri => uri.href).toArray();
				assert.sameMembers(files, [
					baseUri + 'tweedledee',
					baseUri + 'tweedledum',
					baseUri + 'foo/bar.ts',
					baseUri + '%40types/diff/index.d.ts'
				]);
			});
			it('should return all files under specific root', async () => {
				const files = iterate(await fileSystem.getWorkspaceFiles(new URL('foo/', baseUri.href))).map(uri => uri.href).toArray();
				assert.sameMembers(files, [
					baseUri + 'foo/bar.ts'
				]);
			});
		});
		describe('getTextDocumentContent()', () => {
			it('should read files denoted by absolute URI', async () => {
				assert.equal(await fileSystem.getTextDocumentContent(new URL('tweedledee', baseUri.href)), 'hi');
			});
		});
	});
});
