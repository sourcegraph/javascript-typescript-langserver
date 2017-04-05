import * as chai from 'chai';
import iterate from 'iterare';
import * as fs from 'mz/fs';
import * as path from 'path';
import * as rimraf from 'rimraf';
import * as temp from 'temp';
import { LocalFileSystem } from '../fs';
import { path2uri, toUnixPath } from '../util';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('fs.ts', () => {
	describe('LocalFileSystem', () => {
		let temporaryDir: string;
		let fileSystem: LocalFileSystem;
		let baseUri: string;

		before(async () => {
			temporaryDir = await new Promise<string>((resolve, reject) => {
				temp.mkdir('local-fs', (err: Error, dirPath: string) => err ? reject(err) : resolve(dirPath));
			});
			baseUri = path2uri('', temporaryDir) + '/';
			await fs.mkdir(path.join(temporaryDir, 'foo'));
			await fs.writeFile(path.join(temporaryDir, 'tweedledee'), 'hi');
			await fs.writeFile(path.join(temporaryDir, 'tweedledum'), 'bye');
			await fs.writeFile(path.join(temporaryDir, 'foo', 'bar.ts'), 'baz');
			fileSystem = new LocalFileSystem(toUnixPath(temporaryDir));
		});
		after(async () => {
			await new Promise<void>((resolve, reject) => {
				rimraf(temporaryDir, err => err ? reject(err) : resolve());
			});
		});

		describe('getWorkspaceFiles()', () => {
			it('should return all files in the workspace', async () => {
				assert.sameMembers(iterate(await fileSystem.getWorkspaceFiles()).toArray(), [
					baseUri + 'tweedledee',
					baseUri + 'tweedledum',
					baseUri + 'foo/bar.ts'
				]);
			});
			it('should return all files under specific root', async () => {
				assert.sameMembers(iterate(await fileSystem.getWorkspaceFiles(baseUri + 'foo')).toArray(), [
					baseUri + 'foo/bar.ts'
				]);
			});
		});
		describe('getTextDocumentContent()', () => {
			it('should read files denoted by relative URI', async () => {
				assert.equal(await fileSystem.getTextDocumentContent('tweedledee'), 'hi');
			});
			it('should read files denoted by absolute URI', async () => {
				assert.equal(await fileSystem.getTextDocumentContent(baseUri + 'tweedledee'), 'hi');
			});
		});
	});
});
