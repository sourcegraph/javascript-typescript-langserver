import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
import { FileSystemUpdater } from '../fs';
import { InMemoryFileSystem } from '../memfs';
import { ProjectManager } from '../project-manager';
import { MapFileSystem } from './fs-helpers';
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('ProjectManager', () => {

	let projectManager: ProjectManager;
	let memfs: InMemoryFileSystem;

	it('should add a ProjectConfiguration when a tsconfig.json is added to the InMemoryFileSystem', () => {
		memfs = new InMemoryFileSystem('/');
		const localfs = new MapFileSystem(new Map([
			['file:///foo/tsconfig.json', '{}']
		]));
		const updater = new FileSystemUpdater(localfs, memfs);
		projectManager = new ProjectManager('/', memfs, updater, true);
		memfs.add('file:///foo/tsconfig.json', '{}');
		const configs = Array.from(projectManager.configurations());
		assert.isDefined(configs.find(config => config.configFilePath === '/foo/tsconfig.json'));
	});

	describe('getPackageName()', () => {
		beforeEach(async () => {
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///package.json', '{"name": "package-name-1"}'],
				['file:///subdirectory-with-tsconfig/package.json', '{"name": "package-name-2"}'],
				['file:///subdirectory-with-tsconfig/src/tsconfig.json', '{}'],
				['file:///subdirectory-with-tsconfig/src/dummy.ts', '']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, true);
			await projectManager.ensureAllFiles().toPromise();
		});
	});
	describe('ensureReferencedFiles()', () => {
		beforeEach(() => {
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///package.json', '{"name": "package-name-1"}'],
				['file:///node_modules/somelib/index.js', '/// <reference path="./pathref.d.ts"/>\n/// <reference types="node"/>'],
				['file:///node_modules/somelib/pathref.d.ts', ''],
				['file:///node_modules/%40types/node/index.d.ts', ''],
				['file:///src/dummy.ts', 'import * as somelib from "somelib";']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, true);
		});
		it('should ensure content for imports and references is fetched', async () => {
			await projectManager.ensureReferencedFiles('file:///src/dummy.ts').toPromise();
			memfs.getContent('file:///node_modules/somelib/index.js');
			memfs.getContent('file:///node_modules/somelib/pathref.d.ts');
			memfs.getContent('file:///node_modules/%40types/node/index.d.ts');
		});
	});
	describe('getConfiguration()', () => {
		beforeEach(async () => {
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///tsconfig.json', '{}'],
				['file:///src/jsconfig.json', '{}']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, true);
			await projectManager.ensureAllFiles().toPromise();
		});
		it('should resolve best configuration based on file name', () => {
			const jsConfig = projectManager.getConfiguration('/src/foo.js');
			const tsConfig = projectManager.getConfiguration('/src/foo.ts');
			assert.equal('/tsconfig.json', tsConfig.configFilePath);
			assert.equal('/src/jsconfig.json', jsConfig.configFilePath);
		});
	});
	describe('getParentConfiguration()', () => {
		beforeEach(async () => {
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///tsconfig.json', '{}'],
				['file:///src/jsconfig.json', '{}']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, true);
			await projectManager.ensureAllFiles().toPromise();
		});
		it('should resolve best configuration based on file name', () => {
			const config = projectManager.getParentConfiguration('file:///src/foo.ts');
			assert.isDefined(config);
			assert.equal('/tsconfig.json', config!.configFilePath);
		});
	});
	describe('getChildConfigurations()', () => {
		beforeEach(async () => {
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///tsconfig.json', '{}'],
				['file:///foo/bar/tsconfig.json', '{}'],
				['file:///foo/baz/tsconfig.json', '{}']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, true);
			await projectManager.ensureAllFiles().toPromise();
		});
		it('should resolve best configuration based on file name', () => {
			const configs = Array.from(projectManager.getChildConfigurations('file:///foo')).map(config => config.configFilePath);
			assert.deepEqual(configs, [
				'/foo/bar/tsconfig.json',
				'/foo/baz/tsconfig.json'
			]);
		});
	});
});
