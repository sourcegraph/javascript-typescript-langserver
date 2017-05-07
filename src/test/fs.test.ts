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

			// global packages contains a package
			const globalPackagesDir = path.join(temporaryDir, 'node_modules');
			await fs.mkdir(globalPackagesDir);
			const somePackageDir = path.join(globalPackagesDir, 'some_package');
			await fs.mkdir(somePackageDir);
			await fs.mkdir(path.join(somePackageDir, 'src'));
			await fs.writeFile(path.join(somePackageDir, 'src', 'function.ts'), 'foo');

			// the project dir
			const projectDir = path.join(temporaryDir, 'project');
			baseUri = path2uri('', projectDir) + '/';
			await fs.mkdir(projectDir);
			await fs.mkdir(path.join(projectDir, 'foo'));
			await fs.mkdir(path.join(projectDir, '@types'));
			await fs.mkdir(path.join(projectDir, '@types', 'diff'));
			await fs.mkdir(path.join(projectDir, 'node_modules'));
			await fs.writeFile(path.join(projectDir, 'tweedledee'), 'hi');
			await fs.writeFile(path.join(projectDir, 'tweedledum'), 'bye');
			await fs.writeFile(path.join(projectDir, 'foo', 'bar.ts'), 'baz');
			await fs.writeFile(path.join(projectDir, '@types', 'diff', 'index.d.ts'), 'baz');

			// global package is symolinked into project using npm link
			if (process.platform === 'win32') {
				await fs.symlink(somePackageDir, path.join(projectDir, 'node_modules', 'some_package'), 'junction');
			} else {
				await fs.symlink(somePackageDir, path.join(projectDir, 'node_modules', 'some_package'));
			}
			fileSystem = new LocalFileSystem(toUnixPath(projectDir));
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
					baseUri + 'foo/bar.ts',
					baseUri + '%40types/diff/index.d.ts',
					baseUri + 'node_modules/some_package/src/function.ts'
				]);
			});
			it('should return all files under specific root', async () => {
				assert.sameMembers(iterate(await fileSystem.getWorkspaceFiles(baseUri + 'foo')).toArray(), [
					baseUri + 'foo/bar.ts'
				]);
			});
		});
		describe('getTextDocumentContent()', () => {
			it('should read files denoted by absolute URI', async () => {
				assert.equal(await fileSystem.getTextDocumentContent(baseUri + 'tweedledee'), 'hi');
			});
		});
	});
});
