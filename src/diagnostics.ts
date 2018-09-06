import * as ts from 'typescript'
import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver'

/**
 * Converts a TypeScript Diagnostic to an LSP Diagnostic
 */
export function convertTsDiagnostic(diagnostic: ts.DiagnosticWithLocation): Diagnostic {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    const range: Range =  {
        start: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start),
        end: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + diagnostic.length),
    }
    return {
        range,
        message: text,
        severity: convertDiagnosticCategory(diagnostic.category),
        code: diagnostic.code,
        source: diagnostic.source || 'ts',
    }
}

/**
 * Converts a diagnostic category to an LSP DiagnosticSeverity
 *
 * @param category The Typescript DiagnosticCategory
 */
function convertDiagnosticCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
    switch (category) {
        case ts.DiagnosticCategory.Error:
            return DiagnosticSeverity.Error
        case ts.DiagnosticCategory.Warning:
            return DiagnosticSeverity.Warning
        case ts.DiagnosticCategory.Message:
            return DiagnosticSeverity.Information
        case ts.DiagnosticCategory.Suggestion:
            return DiagnosticSeverity.Hint
    }
}
