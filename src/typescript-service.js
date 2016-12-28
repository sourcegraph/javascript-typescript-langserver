"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const path_ = require("path");
const ts = require("typescript");
const vscode_languageserver_1 = require("vscode-languageserver");
const async = require("async");
const util = require("./util");
const pm = require("./project-manager");
/**
 * TypeScriptService handles incoming requests and return
 * responses. There is a one-to-one-to-one correspondence between TCP
 * connection, TypeScriptService instance, and language
 * workspace. TypeScriptService caches data from the compiler across
 * requests. The lifetime of the TypeScriptService instance is tied to
 * the lifetime of the TCP connection, so its caches are deleted after
 * the connection is torn down.
 */
class TypeScriptService {
    constructor(traceModuleResolution) {
        this.traceModuleResolution = traceModuleResolution || false;
    }
    initialize(params, remoteFs, strict) {
        if (this.initialized) {
            return this.initialized;
        }
        this.initialized = new Promise((resolve) => {
            if (params.rootPath) {
                this.root = util.uri2path(params.rootPath);
                this.strict = strict;
                this.projectManager = new pm.ProjectManager(this.root, remoteFs, strict, this.traceModuleResolution);
                this.projectManager.ensureFilesForWorkspaceSymbol(); // pre-fetching
                resolve({
                    capabilities: {
                        // Tell the client that the server works in FULL text document sync mode
                        textDocumentSync: vscode_languageserver_1.TextDocumentSyncKind.Full,
                        hoverProvider: true,
                        definitionProvider: true,
                        referencesProvider: true,
                        workspaceSymbolProvider: true
                    }
                });
            }
        });
        return this.initialized;
    }
    shutdown() { return Promise.resolve(); }
    getDefinition(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = util.uri2reluri(params.textDocument.uri, this.root);
            const line = params.position.line;
            const column = params.position.character;
            yield this.projectManager.ensureFilesForHoverAndDefinition(uri);
            const fileName = util.uri2path(uri);
            const configuration = this.projectManager.getConfiguration(fileName);
            yield configuration.ensureBasicFiles();
            const sourceFile = this.getSourceFile(configuration, fileName);
            if (!sourceFile) {
                return [];
            }
            const offset = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
            const defs = configuration.getService().getDefinitionAtPosition(fileName, offset);
            const ret = [];
            if (defs) {
                for (let def of defs) {
                    const sourceFile = this.getSourceFile(configuration, def.fileName);
                    if (!sourceFile) {
                        throw new Error('expected source file "' + def.fileName + '" to exist in configuration');
                    }
                    const start = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
                    const end = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start + def.textSpan.length);
                    ret.push(vscode_languageserver_1.Location.create(this.defUri(def.fileName), {
                        start: start,
                        end: end
                    }));
                }
            }
            return ret;
        });
    }
    getHover(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = util.uri2reluri(params.textDocument.uri, this.root);
            const line = params.position.line;
            const column = params.position.character;
            yield this.projectManager.ensureFilesForHoverAndDefinition(uri);
            const fileName = util.uri2path(uri);
            const configuration = this.projectManager.getConfiguration(fileName);
            yield configuration.ensureBasicFiles();
            let sourceFile = this.getSourceFile(configuration, fileName);
            if (!sourceFile) {
                return null;
            }
            const offset = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
            const info = configuration.getService().getQuickInfoAtPosition(fileName, offset);
            if (!info) {
                return null;
            }
            const contents = [];
            contents.push({
                language: 'typescript',
                value: ts.displayPartsToString(info.displayParts)
            });
            let documentation = ts.displayPartsToString(info.documentation);
            if (documentation) {
                contents.push(documentation);
            }
            const start = ts.getLineAndCharacterOfPosition(sourceFile, info.textSpan.start);
            const end = ts.getLineAndCharacterOfPosition(sourceFile, info.textSpan.start + info.textSpan.length);
            return { contents: contents, range: vscode_languageserver_1.Range.create(start.line, start.character, end.line, end.character) };
        });
    }
    getReferences(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = util.uri2reluri(params.textDocument.uri, this.root);
            const line = params.position.line;
            const column = params.position.character;
            const fileName = util.uri2path(uri);
            yield this.projectManager.ensureFilesForReferences(uri);
            const configuration = this.projectManager.getConfiguration(fileName);
            yield configuration.ensureAllFiles();
            const sourceFile = this.getSourceFile(configuration, fileName);
            if (!sourceFile) {
                return [];
            }
            const started = new Date().getTime();
            const prepared = new Date().getTime();
            const offset = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
            const refs = configuration.getService().getReferencesAtPosition(fileName, offset);
            const fetched = new Date().getTime();
            const tasks = [];
            if (refs) {
                for (let ref of refs) {
                    tasks.push(this.transformReference(this.root, configuration.getProgram(), ref));
                }
            }
            return new Promise((resolve, reject) => {
                async.parallel(tasks, (err, results) => {
                    const finished = new Date().getTime();
                    console.error('references', 'transform', (finished - fetched) / 1000.0, 'fetch', (fetched - prepared) / 1000.0, 'prepare', (prepared - started) / 1000.0);
                    return resolve(results);
                });
            });
        });
    }
    getWorkspaceSymbols(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const query = params.query;
            const limit = params.limit;
            yield this.projectManager.ensureFilesForWorkspaceSymbol();
            if (!query && this.emptyQueryWorkspaceSymbols) {
                return this.emptyQueryWorkspaceSymbols;
            }
            const configs = this.projectManager.getConfigurations();
            const itemsPromise = this.collectWorkspaceSymbols(query, configs);
            if (!query) {
                this.emptyQueryWorkspaceSymbols = itemsPromise;
            }
            return (yield itemsPromise).slice(0, limit);
        });
    }
    getDocumentSymbol(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = util.uri2reluri(params.textDocument.uri, this.root);
            yield this.projectManager.ensureFilesForHoverAndDefinition(uri);
            const fileName = util.uri2path(uri);
            const config = this.projectManager.getConfiguration(uri);
            yield config.ensureBasicFiles();
            const sourceFile = this.getSourceFile(config, fileName);
            if (!sourceFile) {
                return [];
            }
            const tree = config.getService().getNavigationTree(fileName);
            const result = [];
            this.flattenNavigationTreeItem(tree, null, sourceFile, result);
            return Promise.resolve(result);
        });
    }
    getWorkspaceReference(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const refInfo = [];
            return this.projectManager.ensureFilesForWorkspaceSymbol().then(() => {
                return Promise.all(this.projectManager.getConfigurations().map((config) => __awaiter(this, void 0, void 0, function* () {
                    yield config.ensureAllFiles();
                    for (let source of config.getService().getProgram().getSourceFiles().sort((a, b) => a.fileName.localeCompare(b.fileName))) {
                        if (util.normalizePath(source.fileName).indexOf(`${path_.posix.sep}node_modules${path_.posix.sep}`) !== -1) {
                            continue;
                        }
                        this.walkMostAST(source, (node) => {
                            switch (node.kind) {
                                case ts.SyntaxKind.Identifier: {
                                    const defs = config.getService().getDefinitionAtPosition(source.fileName, node.pos + 1);
                                    if (defs && defs.length > 0) {
                                        const def = defs[0];
                                        const start = ts.getLineAndCharacterOfPosition(source, node.pos);
                                        const end = ts.getLineAndCharacterOfPosition(source, node.end);
                                        const ref = {
                                            location: {
                                                uri: this.defUri(source.fileName),
                                                range: {
                                                    start: start,
                                                    end: end,
                                                },
                                            },
                                            name: def.name,
                                            containerName: def.containerName,
                                            uri: this.defUri(def.fileName),
                                        };
                                        refInfo.push(ref);
                                    }
                                    break;
                                }
                                case ts.SyntaxKind.StringLiteral: {
                                    // TODO
                                    break;
                                }
                            }
                        });
                    }
                })));
            }).then(() => {
                return refInfo;
            });
        });
    }
    /*
     * walkMostAST walks most of the AST (the part that matters for gathering all references)
     */
    walkMostAST(node, visit) {
        visit(node);
        const children = [];
        switch (node.kind) {
            case ts.SyntaxKind.QualifiedName: {
                const n = node;
                children.push(n.left, n.right);
                break;
            }
            case ts.SyntaxKind.ComputedPropertyName: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.TypeParameter: {
                const n = node;
                pushall(children, n.name, n.constraint, n.expression);
                break;
            }
            case ts.SyntaxKind.Parameter: {
                const n = node;
                pushall(children, n.name, n.type, n.initializer);
                break;
            }
            case ts.SyntaxKind.Decorator: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.PropertySignature: {
                const n = node;
                pushall(children, n.name, n.type, n.initializer);
                break;
            }
            case ts.SyntaxKind.PropertyDeclaration: {
                const n = node;
                pushall(children, n.name, n.type, n.initializer);
                break;
            }
            case ts.SyntaxKind.MethodSignature: {
                const n = node;
                pushall(children, n.name, n.type);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                if (n.parameters) {
                    children.push(...n.parameters);
                }
                break;
            }
            case ts.SyntaxKind.MethodDeclaration: {
                const n = node;
                pushall(children, n.name, n.body);
                break;
            }
            case ts.SyntaxKind.Constructor: {
                const n = node;
                pushall(children, n.name, n.body);
                break;
            }
            case ts.SyntaxKind.GetAccessor: {
                const n = node;
                children.push(n.name, n.body);
                break;
            }
            case ts.SyntaxKind.SetAccessor: {
                const n = node;
                children.push(n.name, n.body);
                break;
            }
            case ts.SyntaxKind.CallSignature: {
                const n = node;
                pushall(children, n.name, n.type);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                if (n.parameters) {
                    children.push(...n.parameters);
                }
                break;
            }
            case ts.SyntaxKind.ConstructSignature: {
                const n = node;
                pushall(children, n.name, n.type);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                if (n.parameters) {
                    children.push(...n.parameters);
                }
                break;
            }
            case ts.SyntaxKind.IndexSignature: {
                const n = node;
                pushall(children, n.name, n.type);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                if (n.parameters) {
                    children.push(...n.parameters);
                }
                break;
            }
            case ts.SyntaxKind.TypePredicate: {
                const n = node;
                children.push(n.parameterName, n.type);
                break;
            }
            case ts.SyntaxKind.TypeReference: {
                const n = node;
                children.push(n.typeName);
                if (n.typeArguments) {
                    children.push(...n.typeArguments);
                }
                break;
            }
            case ts.SyntaxKind.ConstructorType:
            case ts.SyntaxKind.FunctionType: {
                const n = node;
                pushall(children, n.name, n.type);
                pushall(children, n.name, n.type);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                if (n.parameters) {
                    children.push(...n.parameters);
                }
                break;
            }
            case ts.SyntaxKind.TypeQuery: {
                const n = node;
                children.push(n.exprName);
                break;
            }
            case ts.SyntaxKind.TypeLiteral: {
                const n = node;
                pushall(children, n.name);
                children.push(...n.members);
                break;
            }
            case ts.SyntaxKind.ArrayType: {
                const n = node;
                children.push(n.elementType);
                break;
            }
            case ts.SyntaxKind.TupleType: {
                const n = node;
                children.push(...n.elementTypes);
                break;
            }
            case ts.SyntaxKind.IntersectionType:
            case ts.SyntaxKind.UnionType: {
                const n = node;
                children.push(...n.types);
                break;
            }
            case ts.SyntaxKind.ParenthesizedType: {
                const n = node;
                children.push(n.type);
                break;
            }
            case ts.SyntaxKind.LiteralType: {
                const n = node;
                children.push(n.literal);
                break;
            }
            case ts.SyntaxKind.ObjectBindingPattern:
            case ts.SyntaxKind.ArrayBindingPattern: {
                const n = node;
                children.push(...n.elements);
                break;
            }
            case ts.SyntaxKind.BindingElement: {
                const n = node;
                pushall(children, n.propertyName, n.name, n.initializer);
                break;
            }
            case ts.SyntaxKind.ArrayLiteralExpression: {
                const n = node;
                children.push(...n.elements);
                break;
            }
            case ts.SyntaxKind.ObjectLiteralExpression: {
                const n = node;
                children.push(...n.properties);
                break;
            }
            case ts.SyntaxKind.PropertyAccessExpression: {
                const n = node;
                children.push(n.expression, n.name);
                break;
            }
            case ts.SyntaxKind.ElementAccessExpression: {
                const n = node;
                pushall(children, n.expression, n.argumentExpression);
                break;
            }
            case ts.SyntaxKind.CallExpression: {
                const n = node;
                pushall(children, n.name, n.expression, ...n.arguments);
                if (n.typeArguments) {
                    children.push(...n.typeArguments);
                }
                break;
            }
            case ts.SyntaxKind.NewExpression: {
                const n = node;
                pushall(children, n.name, n.expression, ...n.arguments);
                if (n.typeArguments) {
                    children.push(...n.typeArguments);
                }
                break;
            }
            case ts.SyntaxKind.TaggedTemplateExpression: {
                const n = node;
                children.push(n.tag, n.template);
                break;
            }
            case ts.SyntaxKind.TypeAssertionExpression: {
                const n = node;
                children.push(n.type, n.expression);
                break;
            }
            case ts.SyntaxKind.ParenthesizedExpression: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.FunctionExpression: {
                const n = node;
                pushall(children, n.name, n.body);
                break;
            }
            case ts.SyntaxKind.ArrowFunction: {
                const n = node;
                children.push(n.body);
                break;
            }
            case ts.SyntaxKind.DeleteExpression: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.TypeOfExpression: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.VoidExpression: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.AwaitExpression: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.PrefixUnaryExpression: {
                const n = node;
                children.push(n.operand);
                break;
            }
            case ts.SyntaxKind.PostfixUnaryExpression: {
                const n = node;
                children.push(n.operand);
                break;
            }
            case ts.SyntaxKind.BinaryExpression: {
                const n = node;
                children.push(n.left, n.right);
                break;
            }
            case ts.SyntaxKind.ConditionalExpression: {
                const n = node;
                children.push(n.condition, n.whenTrue, n.whenFalse);
                break;
            }
            case ts.SyntaxKind.TemplateExpression: {
                const n = node;
                children.push(n.head, ...n.templateSpans);
                break;
            }
            case ts.SyntaxKind.YieldExpression: {
                const n = node;
                pushall(children, n.expression);
                break;
            }
            case ts.SyntaxKind.SpreadElementExpression: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.ClassExpression: {
                const n = node;
                pushall(children, n.name, ...n.members);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                if (n.heritageClauses) {
                    children.push(...n.heritageClauses);
                }
                break;
            }
            case ts.SyntaxKind.ExpressionWithTypeArguments: {
                const n = node;
                children.push(n.expression);
                if (n.typeArguments) {
                    children.push(...n.typeArguments);
                }
                break;
            }
            case ts.SyntaxKind.AsExpression: {
                const n = node;
                children.push(n.expression, n.type);
                break;
            }
            case ts.SyntaxKind.NonNullExpression: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.TemplateSpan: {
                const n = node;
                children.push(n.expression, n.literal);
                break;
            }
            case ts.SyntaxKind.SemicolonClassElement: {
                const n = node;
                if (n.name) {
                    children.push(n.name);
                }
                break;
            }
            case ts.SyntaxKind.Block: {
                const n = node;
                children.push(...n.statements);
                break;
            }
            case ts.SyntaxKind.VariableStatement: {
                const n = node;
                children.push(n.declarationList);
                break;
            }
            case ts.SyntaxKind.ExpressionStatement: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.IfStatement: {
                const n = node;
                pushall(children, n.expression, n.thenStatement, n.elseStatement);
                break;
            }
            case ts.SyntaxKind.DoStatement: {
                const n = node;
                children.push(n.expression, n.statement);
                break;
            }
            case ts.SyntaxKind.WhileStatement: {
                const n = node;
                children.push(n.expression, n.statement);
                break;
            }
            case ts.SyntaxKind.ForStatement: {
                const n = node;
                pushall(children, n.initializer, n.condition, n.incrementor, n.statement);
                break;
            }
            case ts.SyntaxKind.ForInStatement: {
                const n = node;
                children.push(n.initializer, n.expression, n.statement);
                break;
            }
            case ts.SyntaxKind.ForOfStatement: {
                const n = node;
                children.push(n.initializer, n.expression, n.statement);
                break;
            }
            case ts.SyntaxKind.ContinueStatement: {
                const n = node;
                if (n.label) {
                    children.push(n.label);
                }
                break;
            }
            case ts.SyntaxKind.BreakStatement: {
                const n = node;
                if (n.label) {
                    children.push(n.label);
                }
                break;
            }
            case ts.SyntaxKind.ReturnStatement: {
                const n = node;
                if (n.expression) {
                    children.push(n.expression);
                }
                break;
            }
            case ts.SyntaxKind.WithStatement: {
                const n = node;
                children.push(n.expression, n.statement);
                break;
            }
            case ts.SyntaxKind.SwitchStatement: {
                const n = node;
                children.push(n.expression, n.caseBlock);
                break;
            }
            case ts.SyntaxKind.LabeledStatement: {
                const n = node;
                children.push(n.label, n.statement);
                break;
            }
            case ts.SyntaxKind.ThrowStatement: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.TryStatement: {
                const n = node;
                pushall(children, n.tryBlock, n.catchClause, n.finallyBlock);
                break;
            }
            case ts.SyntaxKind.VariableDeclaration: {
                const n = node;
                pushall(children, n.name, n.type, n.initializer);
                break;
            }
            case ts.SyntaxKind.VariableDeclarationList: {
                const n = node;
                children.push(...n.declarations);
                break;
            }
            case ts.SyntaxKind.FunctionDeclaration: {
                const n = node;
                pushall(children, n.name, n.body, n.type, ...n.parameters);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                break;
            }
            case ts.SyntaxKind.ClassDeclaration: {
                const n = node;
                pushall(children, n.name, ...n.members);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                if (n.heritageClauses) {
                    children.push(...n.heritageClauses);
                }
                break;
            }
            case ts.SyntaxKind.InterfaceDeclaration: {
                const n = node;
                children.push(n.name, ...n.members);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                if (n.heritageClauses) {
                    children.push(...n.heritageClauses);
                }
                break;
            }
            case ts.SyntaxKind.TypeAliasDeclaration: {
                const n = node;
                children.push(n.name, n.type);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                break;
            }
            case ts.SyntaxKind.EnumDeclaration: {
                const n = node;
                children.push(n.name, ...n.members);
                break;
            }
            case ts.SyntaxKind.ModuleDeclaration: {
                const n = node;
                pushall(children, n.name, n.body);
                break;
            }
            case ts.SyntaxKind.ModuleBlock: {
                const n = node;
                children.push(...n.statements);
                break;
            }
            case ts.SyntaxKind.CaseBlock: {
                const n = node;
                children.push(...n.clauses);
                break;
            }
            case ts.SyntaxKind.NamespaceExportDeclaration: {
                const n = node;
                children.push(n.name, n.moduleReference);
                break;
            }
            case ts.SyntaxKind.ImportEqualsDeclaration: {
                const n = node;
                children.push(n.name, n.moduleReference);
                break;
            }
            case ts.SyntaxKind.ImportDeclaration: {
                const n = node;
                pushall(children, n.importClause, n.moduleSpecifier);
                break;
            }
            case ts.SyntaxKind.ImportClause: {
                const n = node;
                pushall(children, n.name, n.namedBindings);
                break;
            }
            case ts.SyntaxKind.NamespaceImport: {
                const n = node;
                children.push(n.name);
                break;
            }
            case ts.SyntaxKind.NamedImports: {
                const n = node;
                children.push(...n.elements);
                break;
            }
            case ts.SyntaxKind.ImportSpecifier: {
                const n = node;
                pushall(children, n.propertyName, n.name);
                break;
            }
            case ts.SyntaxKind.ExportAssignment: {
                const n = node;
                pushall(children, n.name, n.expression);
                break;
            }
            case ts.SyntaxKind.ExportDeclaration: {
                const n = node;
                pushall(children, n.exportClause, n.moduleSpecifier, n.name);
                break;
            }
            case ts.SyntaxKind.NamedExports: {
                const n = node;
                children.push(...n.elements);
                break;
            }
            case ts.SyntaxKind.ExportSpecifier: {
                const n = node;
                pushall(children, n.propertyName, n.name);
                break;
            }
            case ts.SyntaxKind.MissingDeclaration: {
                const n = node;
                if (n.name) {
                    children.push(n.name);
                }
                break;
            }
            case ts.SyntaxKind.ExternalModuleReference: {
                const n = node;
                pushall(children, n.expression);
                break;
            }
            case ts.SyntaxKind.JsxElement: {
                const n = node;
                children.push(n.openingElement, n.closingElement, ...n.children);
                break;
            }
            case ts.SyntaxKind.JsxSelfClosingElement: {
                const n = node;
                children.push(n.tagName, ...n.attributes);
                break;
            }
            case ts.SyntaxKind.JsxOpeningElement: {
                const n = node;
                children.push(n.tagName, ...n.attributes);
                break;
            }
            case ts.SyntaxKind.JsxClosingElement: {
                const n = node;
                children.push(n.tagName);
                break;
            }
            case ts.SyntaxKind.JsxAttribute: {
                const n = node;
                pushall(children, n.name, n.initializer);
                break;
            }
            case ts.SyntaxKind.JsxSpreadAttribute: {
                const n = node;
                children.push(n.expression);
                break;
            }
            case ts.SyntaxKind.JsxExpression: {
                const n = node;
                if (n.expression) {
                    children.push(n.expression);
                }
                break;
            }
            case ts.SyntaxKind.CaseClause: {
                const n = node;
                children.push(n.expression, ...n.statements);
                break;
            }
            case ts.SyntaxKind.DefaultClause: {
                const n = node;
                children.push(...n.statements);
                break;
            }
            case ts.SyntaxKind.HeritageClause: {
                const n = node;
                if (n.types) {
                    children.push(...n.types);
                }
                break;
            }
            case ts.SyntaxKind.CatchClause: {
                const n = node;
                children.push(n.variableDeclaration, n.block);
                break;
            }
            case ts.SyntaxKind.PropertyAssignment: {
                const n = node;
                children.push(n.name, n.initializer);
                break;
            }
            case ts.SyntaxKind.ShorthandPropertyAssignment: {
                const n = node;
                pushall(children, n.name, n.objectAssignmentInitializer);
                break;
            }
            case ts.SyntaxKind.EnumMember: {
                const n = node;
                pushall(children, n.name, n.initializer);
                break;
            }
            case ts.SyntaxKind.SourceFile: {
                const n = node;
                children.push(...n.statements);
                break;
            }
            case ts.SyntaxKind.JSDocTypeExpression: {
                const n = node;
                children.push(n.type);
                break;
            }
            case ts.SyntaxKind.JSDocArrayType: {
                const n = node;
                children.push(n.elementType);
                break;
            }
            case ts.SyntaxKind.JSDocUnionType: {
                const n = node;
                children.push(...n.types);
                break;
            }
            case ts.SyntaxKind.JSDocTupleType: {
                const n = node;
                children.push(...n.types);
                break;
            }
            case ts.SyntaxKind.JSDocNullableType: {
                const n = node;
                children.push(n.type);
                break;
            }
            case ts.SyntaxKind.JSDocNonNullableType: {
                const n = node;
                children.push(n.type);
                break;
            }
            case ts.SyntaxKind.JSDocRecordType: {
                const n = node;
                children.push(n.literal);
                break;
            }
            case ts.SyntaxKind.JSDocRecordMember: {
                const n = node;
                pushall(children, n.name, n.type, n.initializer);
                break;
            }
            case ts.SyntaxKind.JSDocTypeReference: {
                const n = node;
                children.push(n.name, ...n.typeArguments);
                break;
            }
            case ts.SyntaxKind.JSDocOptionalType: {
                const n = node;
                children.push(n.type);
                break;
            }
            case ts.SyntaxKind.JSDocFunctionType: {
                const n = node;
                pushall(children, n.name, n.type, ...n.parameters);
                if (n.typeParameters) {
                    children.push(...n.typeParameters);
                }
                break;
            }
            case ts.SyntaxKind.JSDocVariadicType: {
                const n = node;
                children.push(n.type);
                break;
            }
            case ts.SyntaxKind.JSDocConstructorType: {
                const n = node;
                children.push(n.type);
                break;
            }
            case ts.SyntaxKind.JSDocThisType: {
                const n = node;
                children.push(n.type);
                break;
            }
            case ts.SyntaxKind.JSDocComment: {
                const n = node;
                if (n.tags) {
                    children.push(...n.tags);
                }
                break;
            }
            case ts.SyntaxKind.JSDocTag: {
                const n = node;
                children.push(n.tagName);
                break;
            }
            case ts.SyntaxKind.JSDocParameterTag: {
                const n = node;
                pushall(children, n.typeExpression, n.postParameterName, n.parameterName);
                if (n.preParameterName) {
                    children.push(n.preParameterName);
                }
                break;
            }
            case ts.SyntaxKind.JSDocReturnTag: {
                const n = node;
                children.push(n.typeExpression);
                break;
            }
            case ts.SyntaxKind.JSDocTypeTag: {
                const n = node;
                children.push(n.typeExpression);
                break;
            }
            case ts.SyntaxKind.JSDocTemplateTag: {
                const n = node;
                children.push(...n.typeParameters);
                break;
            }
            case ts.SyntaxKind.JSDocTypedefTag: {
                const n = node;
                pushall(children, n.fullName, n.typeExpression, n.jsDocTypeLiteral);
                if (n.name) {
                    children.push(n.name);
                }
                break;
            }
            case ts.SyntaxKind.JSDocPropertyTag: {
                const n = node;
                children.push(n.name, n.typeExpression);
                break;
            }
            case ts.SyntaxKind.JSDocTypeLiteral: {
                const n = node;
                if (n.jsDocPropertyTags) {
                    children.push(...n.jsDocPropertyTags);
                }
                if (n.jsDocTypeTag) {
                    children.push(n.jsDocTypeTag);
                }
                break;
            }
            case ts.SyntaxKind.JSDocLiteralType: {
                const n = node;
                children.push(n.literal);
                break;
            }
            case ts.SyntaxKind.SyntaxList: {
                const n = node;
                children.push(...n._children);
                break;
            }
            default:
                break;
        }
        for (const child of children) {
            if (child) {
                this.walkMostAST(child, visit);
            }
        }
    }
    didOpen(params) {
        const uri = util.uri2reluri(params.textDocument.uri, this.root);
        return this.projectManager.ensureFilesForHoverAndDefinition(uri).then(() => {
            this.projectManager.didOpen(util.uri2path(uri), params.textDocument.text);
        });
    }
    didChange(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = util.uri2reluri(params.textDocument.uri, this.root);
            let text = null;
            params.contentChanges.forEach((change) => {
                if (change.range || change.rangeLength) {
                    throw new Error('incremental updates in textDocument/didChange not supported for file ' + params.textDocument.uri);
                }
                text = change.text;
            });
            if (!text) {
                return;
            }
            this.projectManager.didChange(util.uri2path(uri), text);
        });
    }
    didSave(params) {
        const uri = util.uri2reluri(params.textDocument.uri, this.root);
        return this.projectManager.ensureFilesForHoverAndDefinition(uri).then(() => {
            this.projectManager.didSave(util.uri2path(uri));
        });
    }
    didClose(params) {
        const uri = util.uri2reluri(params.textDocument.uri, this.root);
        return this.projectManager.ensureFilesForHoverAndDefinition(uri).then(() => {
            this.projectManager.didClose(util.uri2path(uri));
        });
    }
    /**
     * Fetches (or creates if needed) source file object for a given file name
     * @param configuration project configuration
     * @param fileName file name to fetch source file for or create it
     */
    getSourceFile(configuration, fileName) {
        const sourceFile = configuration.getProgram().getSourceFile(fileName);
        if (sourceFile) {
            return sourceFile;
        }
        if (!this.projectManager.hasFile(fileName)) {
            return null;
        }
        configuration.getHost().addFile(fileName);
        configuration.syncProgram();
        return configuration.getProgram().getSourceFile(fileName);
    }
    /**
     * Produces async function that converts ReferenceEntry object to Location
     */
    transformReference(root, program, ref) {
        return (callback) => {
            const sourceFile = program.getSourceFile(ref.fileName);
            if (!sourceFile) {
                return callback(new Error('source file "' + ref.fileName + '" does not exist'));
            }
            let start = ts.getLineAndCharacterOfPosition(sourceFile, ref.textSpan.start);
            let end = ts.getLineAndCharacterOfPosition(sourceFile, ref.textSpan.start + ref.textSpan.length);
            callback(undefined, vscode_languageserver_1.Location.create(util.path2uri(root, ref.fileName), {
                start: start,
                end: end
            }));
        };
    }
    /**
     * transformNavItem transforms a NavigateToItem instance to a SymbolInformation instance
     */
    transformNavItem(root, program, item) {
        const sourceFile = program.getSourceFile(item.fileName);
        if (!sourceFile) {
            throw new Error('source file "' + item.fileName + '" does not exist');
        }
        let start = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start);
        let end = ts.getLineAndCharacterOfPosition(sourceFile, item.textSpan.start + item.textSpan.length);
        return vscode_languageserver_1.SymbolInformation.create(item.name, util.convertStringtoSymbolKind(item.kind), vscode_languageserver_1.Range.create(start.line, start.character, end.line, end.character), this.defUri(item.fileName), item.containerName);
    }
    collectWorkspaceSymbols(query, configs) {
        return __awaiter(this, void 0, void 0, function* () {
            const configSymbols = yield Promise.all(configs.map((config) => __awaiter(this, void 0, void 0, function* () {
                const symbols = [];
                yield config.ensureAllFiles();
                if (query) {
                    const items = config.getService().getNavigateToItems(query, undefined, undefined, true);
                    for (const item of items) {
                        symbols.push(this.transformNavItem(this.root, config.getProgram(), item));
                    }
                }
                else {
                    Array.prototype.push.apply(symbols, this.getNavigationTreeItems(config));
                }
                return symbols;
            })));
            const symbols = [];
            for (const cs of configSymbols) {
                Array.prototype.push.apply(symbols, cs);
            }
            if (!query) {
                return symbols.sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()));
            }
            return symbols;
        });
    }
    /**
     * Transforms definition's file name to URI. If definition belongs to TypeScript library,
     * returns git://github.com/Microsoft/TypeScript URL, otherwise returns file:// one
     */
    defUri(filePath) {
        filePath = util.normalizePath(filePath);
        if (pm.getTypeScriptLibraries().has(filePath)) {
            return 'git://github.com/Microsoft/TypeScript?v' + ts.version + '#lib/' + path_.basename(filePath);
        }
        return util.path2uri(this.root, filePath);
    }
    /**
     * Fetches up to limit navigation bar items from given project, flattens them
     */
    getNavigationTreeItems(configuration, limit) {
        const result = [];
        const libraries = pm.getTypeScriptLibraries();
        for (const sourceFile of configuration.getProgram().getSourceFiles().sort((a, b) => a.fileName.localeCompare(b.fileName))) {
            // excluding navigation items from TypeScript libraries
            if (libraries.has(util.normalizePath(sourceFile.fileName))) {
                continue;
            }
            const tree = configuration.getService().getNavigationTree(sourceFile.fileName);
            this.flattenNavigationTreeItem(tree, null, sourceFile, result, limit);
            if (limit && result.length >= limit) {
                break;
            }
        }
        return result;
    }
    /**
     * Flattens navigation tree by transforming it to one-dimensional array.
     * Some items (source files, modules) may be excluded
     */
    flattenNavigationTreeItem(item, parent, sourceFile, result, limit) {
        if (!limit || result.length < limit) {
            const acceptable = TypeScriptService.isAcceptableNavigationTreeItem(item);
            if (acceptable) {
                result.push(this.transformNavigationTreeItem(item, parent, sourceFile));
            }
            if (item.childItems) {
                let i = 0;
                while (i < item.childItems.length && (!limit || result.length < limit)) {
                    this.flattenNavigationTreeItem(item.childItems[i], acceptable ? item : null, sourceFile, result, limit);
                    i++;
                }
            }
        }
    }
    /**
     * Transforms NavigationTree to SymbolInformation
     */
    transformNavigationTreeItem(item, parent, sourceFile) {
        const span = item.spans[0];
        let start = ts.getLineAndCharacterOfPosition(sourceFile, span.start);
        let end = ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length);
        return vscode_languageserver_1.SymbolInformation.create(item.text, util.convertStringtoSymbolKind(item.kind), vscode_languageserver_1.Range.create(start.line, start.character, end.line, end.character), this.defUri(sourceFile.fileName), parent ? parent.text : '');
    }
    /**
     * @return true if navigation tree item is acceptable for inclusion into workspace/symbols
     */
    static isAcceptableNavigationTreeItem(item) {
        // modules and source files should be excluded
        if ([ts.ScriptElementKind.moduleElement, "sourcefile"].indexOf(item.kind) >= 0) {
            return false;
        }
        // special items may start with ", (, [, or <
        if (/^[<\(\[\"]/.test(item.text)) {
            return false;
        }
        // magic words
        if (["default", "constructor", "new()"].indexOf(item.text) >= 0) {
            return false;
        }
        return true;
    }
}
exports.TypeScriptService = TypeScriptService;
function pushall(arr, ...elems) {
    for (const e of elems) {
        if (e) {
            arr.push(e);
        }
    }
    return arr.length;
}
//# sourceMappingURL=typescript-service.js.map