import { Span } from 'opentracing/lib';
import * as ts from 'typescript';
import { DiagnosticSeverity, PublishDiagnosticsParams } from 'vscode-languageserver';
import { LanguageClient } from './lang-handler';
import * as util from './util';

/**
 * Receives file diagnostics (typically implemented to send diagnostics to client)
 */
export interface DiagnosticsHandler {
	updateFileDiagnostics(diagnostics: ts.Diagnostic[], span?: Span): void;
}

/**
 * Forwards diagnostics from typescript calls to LSP diagnostics
 */
export class DiagnosticsPublisher implements DiagnosticsHandler {
	/**
	 * The files that were last reported to have errors
	 * If they don't appear in the next update, we must publish empty diagnostics for them.
	 */
	private problemFiles = new Set<string>();

	/**
	 * Requires a connection to the client to send diagnostics to
	 * @param client
	 */
	constructor(private client: LanguageClient) {}

	/**
	 * Receives file diagnostics from eg. ts.getPreEmitDiagnostics
	 * Diagnostics are grouped and published by file, empty diagnostics are sent for files
	 * not present in subsequent updates.
	 * @param diagnostics
	 */
	updateFileDiagnostics(diagnostics: ts.Diagnostic[], childOf = new Span()): void {
		const span = childOf.tracer().startSpan('Publish diagnostics', { childOf });

		// categorize diagnostics by file
		const diagnosticsByFile = this.groupByFile(diagnostics);

		// add empty diagnostics for fixed files, so client marks them as resolved
		for (const file of this.problemFiles) {
			if (!diagnosticsByFile.has(file)) {
				diagnosticsByFile.set(file, []);
			}
		}
		this.problemFiles.clear();

		// for each file: publish and set as problem file
		for (const [file, diagnostics] of diagnosticsByFile) {
			this.publishFileDiagnostics(file, diagnostics);
			if (diagnostics.length > 0) {
				this.problemFiles.add(file);
			}
		}

		span.finish();
	}

	/**
	 * Converts a diagnostic category to an LSP DiagnosticSeverity
	 * @param category The Typescript DiagnosticCategory
	 */
	private parseDiagnosticCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
		switch (category) {
			case ts.DiagnosticCategory.Error:
				return DiagnosticSeverity.Error;
			case ts.DiagnosticCategory.Warning:
				return DiagnosticSeverity.Warning;
			case ts.DiagnosticCategory.Message:
				return DiagnosticSeverity.Information;
				// unmapped: DiagnosticSeverity.Hint
		}
	}

	/**
	 * Sends given diagnostics for a file to the client
	 * @param file Absolute path as specified from the TS API
	 * @param diagnostics Matching file diagnostics from the TS API, empty to clear errors for file
	 */
	private publishFileDiagnostics(file: string, diagnostics: ts.Diagnostic[]): void {
		const params: PublishDiagnosticsParams = {
			uri: util.path2uri('', file),
			diagnostics: diagnostics.map(d => {
				const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
				return {
					range: {
						start: d.file.getLineAndCharacterOfPosition(d.start),
						end: d.file.getLineAndCharacterOfPosition(d.start + d.length)
					},
					message: text,
					severity: this.parseDiagnosticCategory(d.category),
					code: d.code,
					source: 'ts'
				};
			})
		};
		this.client.textDocumentPublishDiagnostics(params);
	}

	/**
	 * Groups all diagnostics per file they were reported on so they can be stored and sent in batches
	 * @param diagnostics All diagnostics received in an update
	 */
	private groupByFile(diagnostics: ts.Diagnostic[]): Map<string, ts.Diagnostic[]> {
		const diagnosticsByFile = new Map<string, ts.Diagnostic[]>();
		for (const diagnostic of diagnostics) {
			// TODO for some reason non-file diagnostics end up in here (where file is undefined)
			const fileName = diagnostic.file && diagnostic.file.fileName;
			if (fileName) {
				const diagnosticsForFile = diagnosticsByFile.get(fileName);
				if (!diagnosticsForFile) {
					diagnosticsByFile.set(fileName, [diagnostic]);
				} else {
					diagnosticsForFile.push(diagnostic);
				}
			}
		}
		return diagnosticsByFile;
	}
}
