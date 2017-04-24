import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
import { Span } from 'opentracing/lib';
import * as sinon from 'sinon';
import * as ts from 'typescript';
import { LogMessageParams } from 'vscode-languageserver/lib/protocol';
import { DiagnosticsPublisher } from '../diagnostics';
import { FileSystemUpdater } from '../fs';
import { LanguageClient } from '../lang-handler';
import { InMemoryFileSystem } from '../memfs';
import { ProjectManager } from '../project-manager';
import { CacheGetParams, CacheSetParams, TextDocumentContentParams, WorkspaceFilesParams} from '../request-type';
import { MapFileSystem } from './fs-helpers';

describe('DiagnosticsPublisher', () => {
	let langClient: LanguageClient;
	let diagnosticsManager;
	const createTSFileDiagnostic = (message: string, file: ts.SourceFile) => {
		return {
			file,
			messageText: message,
			start: 0,
			length: 4,
			category: ts.DiagnosticCategory.Error,
			code: 33
		};
	};
	let publishSpy: sinon.SinonSpy;
	const sourceFile1 = ts.createSourceFile('/file1.ts', '', ts.ScriptTarget.ES2015);
	const file1FailureA = createTSFileDiagnostic('Failure A', sourceFile1);
	const file1FailureB = createTSFileDiagnostic('Failure B', sourceFile1);
	const failureADiagnostic = {
		message: 'Failure A',
		range: { end: { character: 4, line: 0 }, start: { character: 0, line: 0 } },
		severity: 1,
		code: 33,
		source: 'ts'
	};
	const failureBDiagnostic = {
		message: 'Failure B',
		range: { end: { character: 4, line: 0 }, start: { character: 0, line: 0 } },
		severity: 1,
		code: 33,
		source: 'ts'
	};

	beforeEach(() => {
		publishSpy = sinon.spy();
		langClient = {
			textDocumentXcontent(params: TextDocumentContentParams, childOf?: Span) {
				return Promise.reject(new Error('not implemented')); // Promise<TextDocumentItem>;
			},
			workspaceXfiles(params: WorkspaceFilesParams, childOf?: Span) {
				return Promise.reject(new Error('not implemented')); // Promise<TextDocumentIdentifier[]>
			},
			windowLogMessage(params: LogMessageParams) {
				// nop
			},
			xcacheGet(params: CacheGetParams, childOf?: Span) {
				return Promise.reject(new Error('not implemented')); // nop
			},
			xcacheSet(params: CacheSetParams) {
				// nop
			},
			textDocumentPublishDiagnostics : publishSpy
		};

	});

	it('should not update if there are no changes', () => {
		diagnosticsManager = new DiagnosticsPublisher(langClient);
		diagnosticsManager.updateFileDiagnostics([]);
		sinon.assert.notCalled(publishSpy);
	});

	it('should translate a diagnostic correctly', () => {
		diagnosticsManager = new DiagnosticsPublisher(langClient);
		diagnosticsManager.updateFileDiagnostics([file1FailureA]);
		sinon.assert.calledWithExactly(publishSpy, {
			diagnostics: [failureADiagnostic],
			uri: 'file:///file1.ts'
		});
	});

	it('should group diagnostics by file', () => {
		diagnosticsManager = new DiagnosticsPublisher(langClient);
		diagnosticsManager.updateFileDiagnostics([file1FailureA, file1FailureB]);
		sinon.assert.calledWithExactly(publishSpy, {
			diagnostics: [failureADiagnostic, failureBDiagnostic],
			uri: 'file:///file1.ts'
		});
	});

	it('should publish empty diagnostics when file is fixed', () => {
		diagnosticsManager = new DiagnosticsPublisher(langClient);
		diagnosticsManager.updateFileDiagnostics([file1FailureA]);
		sinon.assert.calledWithExactly(publishSpy, {
			diagnostics: [failureADiagnostic],
			uri: 'file:///file1.ts'
		});
		diagnosticsManager.updateFileDiagnostics([]);
		sinon.assert.calledWithExactly(publishSpy, {
			diagnostics: [],
			uri: 'file:///file1.ts'
		});
	});
});

// Integration tests that include TS compilation.
describe('Diagnostics', () => {
	let projectManager: ProjectManager;
	let langClient: LanguageClient;
	let diagnosticsPublisher: DiagnosticsPublisher;
	const errorDiagnostic = {
		diagnostics: [{
			message: "Type '33' is not assignable to type 'string'.",
			range: { end: { character: 10, line: 0 }, start: { character: 6, line: 0 } },
			severity: 1,
			source: 'ts',
			code: 2322
		}],
		uri: 'file:///src/dummy.ts'
	};
	const subdirectoryErrorDiagnostic = {
		diagnostics: errorDiagnostic.diagnostics,
		uri: 'file:///subdirectory-with-tsconfig/src/dummy.ts'
	};
	const emptyDiagnostic = {
		diagnostics: [],
		uri: 'file:///src/dummy.ts'
	};
	const exportContent = 'export function getNumber(): number { return 0; }';
	const importContent = 'import {getNumber} from "./export"; getNumber();';

	const emptyImportDiagnostic = {
		diagnostics: [],
		uri: 'file:///src/import.ts'
	};
	const importDiagnostic = {
		diagnostics: [{
			message: "Module '\"/src/export\"' has no exported member 'getNumber'.",
			range: { end: { character: 17, line: 0 }, start: { character: 8, line: 0 } },
			severity: 1,
			source: 'ts',
			code: 2305
		}],
		uri: 'file:///src/import.ts'
	};

	beforeEach(async () => {
		const memfs = new InMemoryFileSystem('/');
		const localfs = new MapFileSystem(new Map([
			['file:///package.json', '{"name": "package-name-1"}'],
			['file:///tsconfig.json', '{"include": ["src/*.ts"]}'],
			['file:///src/export.ts', exportContent],
			['file:///src/import.ts', importContent],
			['file:///src/dummy.ts', ['const text: string = 33;'].join('\n')],
			['file:///subdirectory-with-tsconfig/src/tsconfig.json', '{}'],
			['file:///subdirectory-with-tsconfig/src/dummy.ts', '']
		]));
		const updater = new FileSystemUpdater(localfs, memfs);
		langClient = {
			textDocumentXcontent(params: TextDocumentContentParams, childOf?: Span) {
				return Promise.reject(new Error('not implemented')); // Promise<TextDocumentItem>;
			},
			workspaceXfiles(params: WorkspaceFilesParams, childOf?: Span) {
				return Promise.reject(new Error('not implemented')); // Promise<TextDocumentIdentifier[]>
			},
			windowLogMessage(params: LogMessageParams) {
				// nop
			},
			xcacheGet(params: CacheGetParams, childOf?: Span) {
				return Promise.reject(new Error('not implemented')); // nop
			},
			xcacheSet(params: CacheSetParams) {
				// nop
			},
			textDocumentPublishDiagnostics : sinon.spy()
		};
		diagnosticsPublisher = new DiagnosticsPublisher(langClient);
		projectManager = new ProjectManager('/', memfs, updater, diagnosticsPublisher, true);
		await projectManager.ensureAllFiles();
	});

	it('should update diagnostics when opening a file', () => {
		projectManager.didOpen('file:///src/dummy.ts', 'const text: string = 33;');
		sinon.assert.calledOnce(langClient.textDocumentPublishDiagnostics as sinon.SinonSpy);
		sinon.assert.calledWithExactly(langClient.textDocumentPublishDiagnostics as sinon.SinonSpy, errorDiagnostic);
	});

	it('should update diagnostics when error is fixed', () => {
		const publishSpy = langClient.textDocumentPublishDiagnostics as sinon.SinonSpy;
		projectManager.didOpen('file:///src/dummy.ts', 'const text: string = 33;');
		sinon.assert.calledWith(publishSpy, errorDiagnostic);
		// TODO: there are many calls to publish diagnostics here, investigate if some can be avoided.
		projectManager.didChange('file:///src/dummy.ts', 'const text: string = "33";');
		publishSpy.lastCall.calledWith(emptyDiagnostic);
	});

	it('should publish when a dependent file breaks an import', () => {
		const publishSpy = langClient.textDocumentPublishDiagnostics as sinon.SinonSpy;
		projectManager.didOpen('file:///src/import.ts', importContent);
		projectManager.didOpen('file:///src/export.ts', exportContent);
		sinon.assert.notCalled(publishSpy);

		projectManager.didChange('file:///src/export.ts', exportContent.replace('getNumber', 'getNumb'));
		sinon.assert.calledWith(publishSpy, importDiagnostic);

		projectManager.didChange('file:///src/export.ts', exportContent);
		publishSpy.lastCall.calledWith(emptyImportDiagnostic);
	});

	it('should report correct url when publishing diagnostics for child configurations', () => {
		projectManager.didOpen('file:///subdirectory-with-tsconfig/src/dummy.ts', 'const text: string = 33;');
		sinon.assert.calledOnce(langClient.textDocumentPublishDiagnostics as sinon.SinonSpy);
		sinon.assert.calledWithExactly(langClient.textDocumentPublishDiagnostics as sinon.SinonSpy, subdirectoryErrorDiagnostic);
	});
});
