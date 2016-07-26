
import * as ts from "typescript";

export function formHover(info: ts.QuickInfo): string {
    return `{${info.kind}, ${info.documentation}}`
}