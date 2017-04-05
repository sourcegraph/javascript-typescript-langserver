import * as chai from 'chai';
import iterate from 'iterare';
import * as fs from 'mz/fs';
import * as path from 'path';
import * as rimraf from 'rimraf';
import * as temp from 'temp';
import { LocalFileSystem } from '../fs';
import { toUnixPath } from '../util';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('fs.ts', () => {
	describe('LocalFileSystem', () => {
		let temporaryDir: string;
		let fileSystem: LocalFileSystem;
		before(async () => {
			temporaryDir = await new Promise<string>((resolve, reject) => {
				temp.mkdir('local-fs', (err: Error, dirPath: string) => err ? reject(err) : resolve(dirPath));
			});
			await fs.mkdir(path.join(temporaryDir, 'foo'));
			await fs.writeFile(path.join(temporaryDir, 'tweedledee'), 'hi');
			await fs.writeFile(path.join(temporaryDir, 'tweedledum'), 'bye');
			await fs.writeFile(path.join(temporaryDir, 'foo', 'bar'), 'baz');
			fileSystem = new LocalFileSystem(toUnixPath(temporaryDir));
		});
		after(async () => {
			await new Promise<void>((resolve, reject) => {
				rimraf(temporaryDir, err => err ? reject(err) : resolve());
			});
		});

		describe('getWorkspaceFiles()', () => {
			it('should fetch all files', async () => {
				assert.sameMembers(iterate(await fileSystem.getWorkspaceFiles()).toArray(), [
					'file://tweedledee',
					'file://tweedledum',
					'file://foo/bar'
				]);
			});
			it('should fetch all files under specific root', async () => {
				assert.sameMembers(iterate(await fileSystem.getWorkspaceFiles('file://foo')).toArray(), [
					'file://bar'
				]);
			});
		});
		describe('getTextDocumentContent()', () => {
			it('should read files denoted by relative path', async () => {
				assert.equal(await fileSystem.getTextDocumentContent('file://tweedledee'), 'hi');
			});
			it('should read files denoted by absolute path', async () => {
				assert.equal(await fileSystem.getTextDocumentContent('file://' + path.posix.join(toUnixPath(temporaryDir), 'tweedledee')), 'hi');
			});
		});
	});
});
