
import * as ts from 'typescript';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';

/**
 * Converts a TypeScript Diagnostic to an LSP Diagnostic
 */
export function convertTsDiagnostic(diagnostic: ts.Diagnostic): Diagnostic {
	const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
	return {
		range: {
			start: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start),
			end: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + diagnostic.length)
		},
		message: text,
		severity: convertDiagnosticCategory(diagnostic.category),
		code: diagnostic.code,
		source: 'ts'
	};
}

/**
 * Converts a diagnostic category to an LSP DiagnosticSeverity
 *
 * @param category The Typescript DiagnosticCategory
 */
function convertDiagnosticCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
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
