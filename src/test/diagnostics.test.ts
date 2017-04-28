import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
import * as sinon from 'sinon';
import * as ts from 'typescript';
import { DiagnosticsPublisher } from '../diagnostics';
import { LanguageClient, RemoteLanguageClient } from '../lang-handler';

describe('DiagnosticsPublisher', () => {
	let langClient: LanguageClient & { textDocumentPublishDiagnostics: sinon.SinonSpy };
	let diagnosticsManager: DiagnosticsPublisher;

	function createTSFileDiagnostic(message: string, file: ts.SourceFile) {
		return {
			file,
			messageText: message,
			start: 0,
			length: 4,
			category: ts.DiagnosticCategory.Error,
			code: 33
		};
	}
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
		langClient = sinon.createStubInstance(RemoteLanguageClient);
	});

	it('should not update if there are no changes', () => {
		diagnosticsManager = new DiagnosticsPublisher(langClient);
		diagnosticsManager.updateFileDiagnostics([]);
		sinon.assert.notCalled(langClient.textDocumentPublishDiagnostics);
	});

	it('should translate a diagnostic correctly', () => {
		diagnosticsManager = new DiagnosticsPublisher(langClient);
		diagnosticsManager.updateFileDiagnostics([file1FailureA]);
		sinon.assert.calledWithExactly(langClient.textDocumentPublishDiagnostics, {
			diagnostics: [failureADiagnostic],
			uri: 'file:///file1.ts'
		});
	});

	it('should group diagnostics by file', () => {
		diagnosticsManager = new DiagnosticsPublisher(langClient);
		diagnosticsManager.updateFileDiagnostics([file1FailureA, file1FailureB]);
		sinon.assert.calledWithExactly(langClient.textDocumentPublishDiagnostics, {
			diagnostics: [failureADiagnostic, failureBDiagnostic],
			uri: 'file:///file1.ts'
		});
	});

	it('should publish empty diagnostics when file is fixed', () => {
		diagnosticsManager = new DiagnosticsPublisher(langClient);
		diagnosticsManager.updateFileDiagnostics([file1FailureA]);
		sinon.assert.calledWithExactly(langClient.textDocumentPublishDiagnostics, {
			diagnostics: [failureADiagnostic],
			uri: 'file:///file1.ts'
		});
		diagnosticsManager.updateFileDiagnostics([]);
		sinon.assert.calledWithExactly(langClient.textDocumentPublishDiagnostics, {
			diagnostics: [],
			uri: 'file:///file1.ts'
		});
	});
});
