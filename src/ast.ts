import * as ts from 'typescript'

/**
 * Returns a Generator that walks most of the AST (the part that matters for gathering all references) and emits Nodes
 *
 * TODO is this function worth it?
 */
export function* walkMostAST(node: ts.Node): IterableIterator<ts.Node> {
    yield node
    const children = node.getChildren()
    for (const child of children) {
        if (child) {
            yield* walkMostAST(child)
        }
    }
}
