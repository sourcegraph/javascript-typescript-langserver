import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;
import { FileSystemUpdater } from '../fs';
import { InMemoryFileSystem } from '../memfs';
import { ProjectManager } from '../project-manager';
import { MapFileSystem } from './fs-helpers';

describe('ProjectManager', () => {

	let projectManager: ProjectManager;

	describe('getPackageName()', () => {
		before(() => {
			const memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///package.json', '{"name": "package-name-1"}'],
				['file:///subdirectory-with-tsconfig/package.json', '{"name": "package-name-2"}'],
				['file:///subdirectory-with-tsconfig/src/tsconfig.json', '{}'],
				['file:///subdirectory-with-tsconfig/src/dummy.ts', '']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, true);
			projectManager.ensureAllFiles();
		});
		it('should resolve package name when package.json is at the same level', () => {
			assert.equal(projectManager.getConfiguration('').getPackageName(), 'package-name-1');
		});
		it('should resolve package name when package.json is at the upper level', () => {
			assert.equal(projectManager.getConfiguration('subdirectory-with-tsconfig/src/dummy.ts').getPackageName(), 'package-name-2');
		});
	});
});
