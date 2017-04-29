import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;
import * as sinon from 'sinon';
import { DiagnosticsHandler } from '../diagnostics';
import { FileSystemUpdater } from '../fs';
import { InMemoryFileSystem } from '../memfs';
import { ProjectManager } from '../project-manager';
import { MapFileSystem } from './fs-helpers';

describe('ProjectManager', () => {

	let projectManager: ProjectManager;
	let memfs: InMemoryFileSystem;
	let diagnosticsHandler: { [K in keyof DiagnosticsHandler]: DiagnosticsHandler[K] & sinon.SinonSpy };

	beforeEach(() => {
		diagnosticsHandler = {
			updateFileDiagnostics: sinon.spy()
		};
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
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsHandler, true);
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
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsHandler, true);
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
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsHandler, true);
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
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///package.json', '{"name": "package-name-1"}'],
				['file:///src/dummy.ts', 'const num: number = "banana";']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsHandler, true);
			await projectManager.ensureAllFiles();
		});
		it('should compile opened file and publish diagnostics', async () => {
			projectManager.didOpen('file:///src/dummy.ts', 'const num: number = "banana";');
			sinon.assert.called(diagnosticsHandler.updateFileDiagnostics);
			const lastDiagnostics = diagnosticsHandler.updateFileDiagnostics.lastCall.args[0];
			assert.lengthOf(lastDiagnostics, 1);
		});
	});
	describe('didChange()', () => {
		beforeEach(async () => {
			diagnosticsHandler.updateFileDiagnostics = diagnosticsHandler.updateFileDiagnostics;
			memfs = new InMemoryFileSystem('/');
			const localfs = new MapFileSystem(new Map([
				['file:///package.json', '{"name": "package-name-1"}'],
				['file:///src/dummy.ts', 'const num: number = "banana";']
			]));
			const updater = new FileSystemUpdater(localfs, memfs);
			projectManager = new ProjectManager('/', memfs, updater, diagnosticsHandler, true);
			await projectManager.ensureAllFiles();
		});
		it('should update program and publish updated diagnostics', async () => {
			projectManager.didOpen('file:///src/dummy.ts', 'const num: number = "banana";');
			sinon.assert.calledWith(diagnosticsHandler.updateFileDiagnostics, []);

			projectManager.didChange('file:///src/dummy.ts', 'const num: number = 55;');
			const lastDiagnostics = diagnosticsHandler.updateFileDiagnostics.lastCall.args[0];
			assert.lengthOf(lastDiagnostics, 0);
		});
	});

});
