import * as ts from 'typescript'
import { SymbolInformation, SymbolKind } from 'vscode-languageserver-types'
import { isTypeScriptLibrary } from './memfs'
import { SymbolDescriptor } from './request-type'
import { path2uri, toUnixPath } from './util'

/**
 * Returns a SymbolDescriptor for a ts.DefinitionInfo
 */
export function definitionInfoToSymbolDescriptor(info: ts.DefinitionInfo, rootPath: string): SymbolDescriptor {
    const rootUnixPath = toUnixPath(rootPath)
    const symbolDescriptor: SymbolDescriptor = {
        kind: info.kind || '',
        name: info.name || '',
        containerKind: info.containerKind || '',
        containerName: info.containerName || '',
        filePath: info.fileName,
    }
    // If the symbol is an external module representing a file, set name to the file path
    if (info.kind === ts.ScriptElementKind.moduleElement && info.name && /[\\\/]/.test(info.name)) {
        symbolDescriptor.name = '"' + info.fileName.replace(/(?:\.d)?\.tsx?$/, '') + '"'
    }
    // If the symbol itself is not a module and there is no containerKind
    // then the container is an external module named by the file name (without file extension)
    if (info.kind !== ts.ScriptElementKind.moduleElement && !info.containerKind && !info.containerName) {
        symbolDescriptor.containerName = '"' + info.fileName.replace(/(?:\.d)?\.tsx?$/, '') + '"'
        symbolDescriptor.containerKind = ts.ScriptElementKind.moduleElement
    }
    normalizeSymbolDescriptorPaths(symbolDescriptor, rootUnixPath)
    return symbolDescriptor
}

/**
 * Transforms definition's file name to URI. If definition belongs to the in-memory TypeScript library,
 * returns git://github.com/Microsoft/TypeScript URL, otherwise returns file:// one
 */
export function locationUri(filePath: string): string {
    if (isTypeScriptLibrary(filePath)) {
        return 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/' + filePath.split(/[\/\\]/g).pop()
    }
    return path2uri(filePath)
}

/**
 * Returns an LSP SymbolInformation for a TypeScript NavigateToItem
 *
 * @param rootPath The workspace rootPath to remove from symbol names and containerNames
 */
export function navigateToItemToSymbolInformation(
    item: ts.NavigateToItem,
    program: ts.Program,
    rootPath: string
): SymbolInformation {
    const sourceFile = program.getSourceFile(item.fileName)
    if (!sourceFile) {
        throw new Error(`Source file ${item.fileName} does not exist`)
    }
    const symbolInformation: SymbolInformation = {
        name: item.name ? item.name.replace(rootPath, '') : '',
        kind: stringtoSymbolKind(item.kind),
        location: {
            uri: locationUri(sourceFile.fileName),
            range: {
                start: ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start),
                end: ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start + item.textSpan.length),
            },
        },
    }
    if (item.containerName) {
        symbolInformation.containerName = item.containerName.replace(rootPath, '')
    }
    return symbolInformation
}

/**
 * Returns an LSP SymbolKind for a TypeScript ScriptElementKind
 */
export function stringtoSymbolKind(kind: string): SymbolKind {
    switch (kind) {
        case 'module':
            return SymbolKind.Module
        case 'class':
            return SymbolKind.Class
        case 'local class':
            return SymbolKind.Class
        case 'interface':
            return SymbolKind.Interface
        case 'enum':
            return SymbolKind.Enum
        case 'enum member':
            return SymbolKind.Constant
        case 'var':
            return SymbolKind.Variable
        case 'local var':
            return SymbolKind.Variable
        case 'function':
            return SymbolKind.Function
        case 'local function':
            return SymbolKind.Function
        case 'method':
            return SymbolKind.Method
        case 'getter':
            return SymbolKind.Method
        case 'setter':
            return SymbolKind.Method
        case 'property':
            return SymbolKind.Property
        case 'constructor':
            return SymbolKind.Constructor
        case 'parameter':
            return SymbolKind.Variable
        case 'type parameter':
            return SymbolKind.Variable
        case 'alias':
            return SymbolKind.Variable
        case 'let':
            return SymbolKind.Variable
        case 'const':
            return SymbolKind.Constant
        case 'JSX attribute':
            return SymbolKind.Property
        // case 'script'
        // case 'keyword'
        // case 'type'
        // case 'call'
        // case 'index'
        // case 'construct'
        // case 'primitive type'
        // case 'label'
        // case 'directory'
        // case 'external module name'
        // case 'external module name'
        default:
            return SymbolKind.Variable
    }
}

/**
 * Returns an LSP SymbolInformation for a TypeScript NavigationTree node
 */
export function navigationTreeToSymbolInformation(
    tree: ts.NavigationTree,
    parent: ts.NavigationTree | undefined,
    sourceFile: ts.SourceFile,
    rootPath: string
): SymbolInformation {
    const span = tree.spans[0]
    if (!span) {
        throw new Error('NavigationTree has no TextSpan')
    }
    const symbolInformation: SymbolInformation = {
        name: tree.text ? tree.text.replace(rootPath, '') : '',
        kind: stringtoSymbolKind(tree.kind),
        location: {
            uri: locationUri(sourceFile.fileName),
            range: {
                start: ts.getLineAndCharacterOfPosition(sourceFile, span.start),
                end: ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length),
            },
        },
    }
    if (parent && navigationTreeIsSymbol(parent) && parent.text) {
        symbolInformation.containerName = parent.text.replace(rootPath, '')
    }
    return symbolInformation
}

/**
 * Returns a SymbolDescriptor for a TypeScript NavigationTree node
 */
export function navigationTreeToSymbolDescriptor(
    tree: ts.NavigationTree,
    parent: ts.NavigationTree | undefined,
    filePath: string,
    rootPath: string
): SymbolDescriptor {
    const symbolDescriptor: SymbolDescriptor = {
        kind: tree.kind,
        name: tree.text ? tree.text.replace(rootPath, '') : '',
        containerKind: '',
        containerName: '',
        filePath,
    }
    if (parent && navigationTreeIsSymbol(parent)) {
        symbolDescriptor.containerKind = parent.kind
        symbolDescriptor.containerName = parent.text
    }
    // If the symbol is an external module representing a file, set name to the file path
    if (tree.kind === ts.ScriptElementKind.moduleElement && !tree.text) {
        symbolDescriptor.name = '"' + filePath.replace(/(?:\.d)?\.tsx?$/, '') + '"'
    }
    // If the symbol itself is not a module and there is no containerKind
    // then the container is an external module named by the file name (without file extension)
    if (symbolDescriptor.kind !== ts.ScriptElementKind.moduleElement && !symbolDescriptor.containerKind) {
        if (!symbolDescriptor.containerName) {
            symbolDescriptor.containerName = '"' + filePath.replace(/(?:\.d)?\.tsx?$/, '') + '"'
        }
        symbolDescriptor.containerKind = ts.ScriptElementKind.moduleElement
    }
    normalizeSymbolDescriptorPaths(symbolDescriptor, rootPath)
    return symbolDescriptor
}

/**
 * Walks a NaviationTree and emits items with a node and its parent node (if exists)
 */
export function* walkNavigationTree(
    tree: ts.NavigationTree,
    parent?: ts.NavigationTree
): IterableIterator<{ tree: ts.NavigationTree; parent?: ts.NavigationTree }> {
    yield { tree, parent }
    for (const childItem of tree.childItems || []) {
        yield* walkNavigationTree(childItem, tree)
    }
}

/**
 * Returns true if the NavigationTree node describes a proper symbol and not a e.g. a category like `<global>`
 */
export function navigationTreeIsSymbol(tree: ts.NavigationTree): boolean {
    // Categories start with (, [, or <
    if (/^[<\(\[]/.test(tree.text)) {
        return false
    }
    // Magic words
    if (['default', 'constructor', 'new()'].indexOf(tree.text) >= 0) {
        return false
    }
    return true
}

/**
 * Makes paths relative to the passed rootPath and strips `node_modules` out of paths
 */
function normalizeSymbolDescriptorPaths(symbol: SymbolDescriptor, rootPath: string): void {
    for (const key of ['name', 'containerName', 'filePath'] as ['name', 'containerName', 'filePath']) {
        // Make all paths that may occur in module names relative to the workspace rootPath
        symbol[key] = symbol[key].replace(rootPath, '')
        // Remove node_modules part from a module name
        // The SymbolDescriptor will be used in the defining repo, where the symbol file path will never contain node_modules
        // It may contain the package name though if the repo is a monorepo with multiple packages
        const regExp = /[^"]*node_modules\//
        symbol[key] = symbol[key].replace(regExp, '')
    }
}
