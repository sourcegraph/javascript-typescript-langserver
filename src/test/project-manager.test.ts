import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;
import * as sinon from 'sinon';
import { FileSystemUpdater } from '../fs';
import { InMemoryFileSystem } from '../memfs';
import { ProjectManager } from '../project-manager';
import { MapFileSystem } from './fs-helpers';

describe('ProjectManager', () => {

	let projectManager: ProjectManager;
	let memfs: InMemoryFileSystem;
	let diagnosticsSpy: sinon.SinonSpy;
	const diagnosticsPublisher = {
		updateFileDiagnostics(diagnostics: any) { /* nop */ }
	};

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
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsPublisher, true);
			await projectManager.ensureAllFiles();
		});
		it('should resolve package name when package.json is at the same level', () => {
			assert.equal(projectManager.getConfiguration('/').getPackageName(), 'package-name-1');
		});
		it('should resolve package name when package.json is at the upper level', () => {
			assert.equal(projectManager.getConfiguration('/subdirectory-with-tsconfig/src/dummy.ts').getPackageName(), 'package-name-2');
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
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsPublisher, true);
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
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsPublisher, true);
			await projectManager.ensureAllFiles();
		});
		it('should resolve best configuration based on file name', () => {
			const jsConfig = projectManager.getConfiguration('/src/foo.js');
			const tsConfig = projectManager.getConfiguration('/src/foo.ts');
			assert.equal('/tsconfig.json', tsConfig.configFilePath);
			assert.equal('/src/jsconfig.json', jsConfig.configFilePath);
		});
	});
	describe('didOpen()', () => {
		beforeEach(async () => {
			diagnosticsSpy = sinon.spy();
			diagnosticsPublisher.updateFileDiagnostics = diagnosticsSpy;
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///package.json', '{"name": "package-name-1"}'],
				['file:///src/dummy.ts', 'const num: number = "banana";']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsPublisher, true);
			await projectManager.ensureAllFiles();
		});
		it('should compile opened file and return diagnostics', async () => {
			projectManager.didOpen('file:///src/dummy.ts', 'const num: number = "banana";');
			const lastArgs = diagnosticsSpy.lastCall.args[0];
			assert.equal(lastArgs.length, 1);
		});
	});
	describe('didChange()', () => {
		beforeEach(async () => {
			diagnosticsSpy = sinon.spy();
			diagnosticsPublisher.updateFileDiagnostics = diagnosticsSpy;
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///package.json', '{"name": "package-name-1"}'],
				['file:///src/dummy.ts', 'const num: number = "banana";']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsPublisher, true);
			await projectManager.ensureAllFiles();
		});
		it('should update program and get updated diagnostics', async () => {
			projectManager.didOpen('file:///src/dummy.ts', 'const num: number = "banana";');
			let lastArgs = diagnosticsSpy.lastCall.args[0];
			assert.equal(lastArgs.length, 1);
			projectManager.didChange('file:///src/dummy.ts', 'const num: number = 55;');
			lastArgs = diagnosticsSpy.lastCall.args[0];
			assert.equal(lastArgs.length, 0);
		});
	});

});
