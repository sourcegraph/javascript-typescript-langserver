import * as fs from 'fs';
import * as path from 'path';

import * as chai from 'chai';
import * as rimraf from 'rimraf';
import * as temp from 'temp';

import { FileSystem, LocalFileSystem } from '../fs';
import { path2uri, toUnixPath } from '../util';

import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;

async function fetchFiles(fs: FileSystem, base?: string | undefined): Promise<string[]> {
	const uris = await fs.getWorkspaceFiles(base);
	const ret = [];
	for (const uri of uris) {
		ret.push(uri);
	}
	return ret;
}
describe('local file system', () => {
	let temporaryDir: string;
	let fileSystem: LocalFileSystem;
	before(() => {
		temporaryDir = temp.mkdirSync('local-fs');
		fs.mkdirSync(path.join(temporaryDir, 'foo'));
		fs.writeFileSync(path.join(temporaryDir, 'tweedledee'), 'hi');
		fs.writeFileSync(path.join(temporaryDir, 'tweedledum'), 'bye');
		fs.writeFileSync(path.join(temporaryDir, 'foo', 'bar'), 'baz');
		fileSystem = new LocalFileSystem(toUnixPath(temporaryDir));
	});
	after(() => {
		rimraf.sync(temporaryDir);
	});
	it('should fetch all files', async () => {
		assert.sameMembers(await fetchFiles(fileSystem), [
			path2uri('', 'tweedledee'),
			path2uri('', 'tweedledum'),
			path2uri('', 'foo/bar')
		]);
	});
	it('should fetch all files under specific root', async () => {
		assert.sameMembers(await fetchFiles(fileSystem, path2uri('', 'foo')), [
			path2uri('', 'bar')
		]);
	});
	it('should read files denoted by relative path', async () => {
		assert.equal(await fileSystem.getTextDocumentContent(path2uri('', 'tweedledee')), 'hi');
	});
	it('should read files denoted by absolute path', async () => {
		assert.equal(await fileSystem.getTextDocumentContent(path2uri('', path.posix.join(toUnixPath(temporaryDir), 'tweedledee'))), 'hi');
	});
});
