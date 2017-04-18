
import * as ts from 'typescript';

/**
 * Returns a Generator that walks most of the AST (the part that matters for gathering all references) and emits Nodes
 *
 * TODO is this function worth it?
 */
export function *walkMostAST(node: ts.Node): IterableIterator<ts.Node> {
	yield node;
	// TODO don't maintain an array
	const children: ts.Node[] = [];
	switch (node.kind) {
		case ts.SyntaxKind.QualifiedName: {
			const n = node as ts.QualifiedName;
			children.push(n.left, n.right);
			break;
		}
		case ts.SyntaxKind.ComputedPropertyName: {
			const n = node as ts.ComputedPropertyName;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.TypeParameter: {
			const n = node as ts.TypeParameterDeclaration;
			pushall(children, n.name, n.constraint, n.expression);
			break;
		}
		case ts.SyntaxKind.Parameter: {
			const n = node as ts.ParameterDeclaration;
			pushall(children, n.name, n.type, n.initializer);
			break;
		}
		case ts.SyntaxKind.Decorator: {
			const n = node as ts.Decorator;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.PropertySignature: {
			const n = node as ts.PropertySignature;
			pushall(children, n.name, n.type, n.initializer);
			break;
		}
		case ts.SyntaxKind.PropertyDeclaration: {
			const n = node as ts.PropertyDeclaration;
			pushall(children, n.name, n.type, n.initializer);
			break;
		}
		case ts.SyntaxKind.MethodSignature: {
			const n = node as ts.MethodSignature;
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
			const n = node as ts.MethodDeclaration;
			pushall(children, n.name, n.body);
			break;
		}
		case ts.SyntaxKind.Constructor: {
			const n = node as ts.ConstructorDeclaration;
			pushall(children, n.name, n.body);
			break;
		}
		case ts.SyntaxKind.GetAccessor: {
			const n = node as ts.GetAccessorDeclaration;
			children.push(n.name, n.body);
			break;
		}
		case ts.SyntaxKind.SetAccessor: {
			const n = node as ts.SetAccessorDeclaration;
			children.push(n.name, n.body);
			break;
		}
		case ts.SyntaxKind.CallSignature: {
			const n = node as ts.CallSignatureDeclaration;
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
			const n = node as ts.ConstructSignatureDeclaration;
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
			const n = node as ts.IndexSignatureDeclaration;
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
			const n = node as ts.TypePredicateNode;
			children.push(n.parameterName, n.type);
			break;
		}
		case ts.SyntaxKind.TypeReference: {
			const n = node as ts.TypeReferenceNode;
			children.push(n.typeName);
			if (n.typeArguments) {
				children.push(...n.typeArguments);
			}
			break;
		}
		case ts.SyntaxKind.ConstructorType:
		case ts.SyntaxKind.FunctionType: {
			const n = node as ts.FunctionOrConstructorTypeNode;
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
			const n = node as ts.TypeQueryNode;
			children.push(n.exprName);
			break;
		}
		case ts.SyntaxKind.TypeLiteral: {
			const n = node as ts.TypeLiteralNode;
			pushall(children, n.name);
			children.push(...n.members);
			break;
		}
		case ts.SyntaxKind.ArrayType: {
			const n = node as ts.ArrayTypeNode;
			children.push(n.elementType);
			break;
		}
		case ts.SyntaxKind.TupleType: {
			const n = node as ts.TupleTypeNode;
			children.push(...n.elementTypes);
			break;
		}
		case ts.SyntaxKind.IntersectionType:
		case ts.SyntaxKind.UnionType: {
			const n = node as ts.UnionTypeNode;
			children.push(...n.types);
			break;
		}
		case ts.SyntaxKind.ParenthesizedType: {
			const n = node as ts.ParenthesizedTypeNode;
			children.push(n.type);
			break;
		}
		case ts.SyntaxKind.LiteralType: {
			const n = node as ts.LiteralTypeNode;
			children.push(n.literal);
			break;
		}
		case ts.SyntaxKind.ObjectBindingPattern:
		case ts.SyntaxKind.ArrayBindingPattern: {
			const n = node as ts.ObjectBindingPattern;
			children.push(...n.elements);
			break;
		}
		case ts.SyntaxKind.BindingElement: {
			const n = node as ts.BindingElement;
			pushall(children, n.propertyName, n.name, n.initializer);
			break;
		}
		case ts.SyntaxKind.ArrayLiteralExpression: {
			const n = node as ts.ArrayLiteralExpression;
			children.push(...n.elements);
			break;
		}
		case ts.SyntaxKind.ObjectLiteralExpression: {
			const n = node as ts.ObjectLiteralExpression;
			children.push(...n.properties);
			break;
		}
		case ts.SyntaxKind.PropertyAccessExpression: {
			const n = node as ts.PropertyAccessExpression;
			children.push(n.expression, n.name);
			break;
		}
		case ts.SyntaxKind.ElementAccessExpression: {
			const n = node as ts.ElementAccessExpression;
			pushall(children, n.expression, n.argumentExpression);
			break;
		}
		case ts.SyntaxKind.CallExpression: {
			const n = node as ts.CallExpression;
			pushall(children, n.name, n.expression, ...n.arguments);
			if (n.typeArguments) {
				children.push(...n.typeArguments);
			}
			break;
		}
		case ts.SyntaxKind.NewExpression: {
			const n = node as ts.NewExpression;
			if (n.name) {
				yield* walkMostAST(n.name);
			}
			yield* walkMostAST(n.expression);
			if (n.arguments) {
				for (const argument of n.arguments) {
					yield* walkMostAST(argument);
				}
			}
			if (n.typeArguments) {
				for (const typeArgument of n.typeArguments) {
					yield* walkMostAST(typeArgument);
				}
			}
			break;
		}
		case ts.SyntaxKind.TaggedTemplateExpression: {
			const n = node as ts.TaggedTemplateExpression;
			children.push(n.tag, n.template);
			break;
		}
		case ts.SyntaxKind.TypeAssertionExpression: {
			const n = node as ts.TypeAssertion;
			children.push(n.type, n.expression);
			break;
		}
		case ts.SyntaxKind.ParenthesizedExpression: {
			const n = node as ts.ParenthesizedExpression;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.FunctionExpression: {
			const n = node as ts.FunctionExpression;
			pushall(children, n.name, n.body);
			break;
		}
		case ts.SyntaxKind.ArrowFunction: {
			const n = node as ts.ArrowFunction;
			children.push(n.body);
			break;
		}
		case ts.SyntaxKind.DeleteExpression: {
			const n = node as ts.DeleteExpression;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.TypeOfExpression: {
			const n = node as ts.TypeOfExpression;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.VoidExpression: {
			const n = node as ts.VoidExpression;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.AwaitExpression: {
			const n = node as ts.AwaitExpression;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.PrefixUnaryExpression: {
			const n = node as ts.PrefixUnaryExpression;
			children.push(n.operand);
			break;
		}
		case ts.SyntaxKind.PostfixUnaryExpression: {
			const n = node as ts.PostfixUnaryExpression;
			children.push(n.operand);
			break;
		}
		case ts.SyntaxKind.BinaryExpression: {
			const n = node as ts.BinaryExpression;
			children.push(n.left, n.right);
			break;
		}
		case ts.SyntaxKind.ConditionalExpression: {
			const n = node as ts.ConditionalExpression;
			children.push(n.condition, n.whenTrue, n.whenFalse);
			break;
		}
		case ts.SyntaxKind.TemplateExpression: {
			const n = node as ts.TemplateExpression;
			children.push(n.head, ...n.templateSpans);
			break;
		}
		case ts.SyntaxKind.YieldExpression: {
			const n = node as ts.YieldExpression;
			pushall(children, n.expression);
			break;
		}
		case ts.SyntaxKind.SpreadElement: {
			const n = node as ts.SpreadElement;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.ClassExpression: {
			const n = node as ts.ClassExpression;
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
			const n = node as ts.ExpressionWithTypeArguments;
			children.push(n.expression);
			if (n.typeArguments) {
				children.push(...n.typeArguments);
			}
			break;
		}
		case ts.SyntaxKind.AsExpression: {
			const n = node as ts.AsExpression;
			children.push(n.expression, n.type);
			break;
		}
		case ts.SyntaxKind.NonNullExpression: {
			const n = node as ts.NonNullExpression;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.TemplateSpan: {
			const n = node as ts.TemplateSpan;
			children.push(n.expression, n.literal);
			break;
		}
		case ts.SyntaxKind.SemicolonClassElement: {
			const n = node as ts.SemicolonClassElement;
			if (n.name) {
				children.push(n.name);
			}
			break;
		}
		case ts.SyntaxKind.Block: {
			const n = node as ts.Block;
			children.push(...n.statements);
			break;
		}
		case ts.SyntaxKind.VariableStatement: {
			const n = node as ts.VariableStatement;
			children.push(n.declarationList);
			break;
		}
		case ts.SyntaxKind.ExpressionStatement: {
			const n = node as ts.ExpressionStatement;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.IfStatement: {
			const n = node as ts.IfStatement;
			pushall(children, n.expression, n.thenStatement, n.elseStatement);
			break;
		}
		case ts.SyntaxKind.DoStatement: {
			const n = node as ts.DoStatement;
			children.push(n.expression, n.statement);
			break;
		}
		case ts.SyntaxKind.WhileStatement: {
			const n = node as ts.WhileStatement;
			children.push(n.expression, n.statement);
			break;
		}
		case ts.SyntaxKind.ForStatement: {
			const n = node as ts.ForStatement;
			pushall(children, n.initializer, n.condition, n.incrementor, n.statement);
			break;
		}
		case ts.SyntaxKind.ForInStatement: {
			const n = node as ts.ForInStatement;
			children.push(n.initializer, n.expression, n.statement);
			break;
		}
		case ts.SyntaxKind.ForOfStatement: {
			const n = node as ts.ForOfStatement;
			children.push(n.initializer, n.expression, n.statement);
			break;
		}
		case ts.SyntaxKind.ContinueStatement: {
			const n = node as ts.ContinueStatement;
			if (n.label) {
				children.push(n.label);
			}
			break;
		}
		case ts.SyntaxKind.BreakStatement: {
			const n = node as ts.BreakStatement;
			if (n.label) {
				children.push(n.label);
			}
			break;
		}
		case ts.SyntaxKind.ReturnStatement: {
			const n = node as ts.ReturnStatement;
			if (n.expression) {
				children.push(n.expression);
			}
			break;
		}
		case ts.SyntaxKind.WithStatement: {
			const n = node as ts.WithStatement;
			children.push(n.expression, n.statement);
			break;
		}
		case ts.SyntaxKind.SwitchStatement: {
			const n = node as ts.SwitchStatement;
			children.push(n.expression, n.caseBlock);
			break;
		}
		case ts.SyntaxKind.LabeledStatement: {
			const n = node as ts.LabeledStatement;
			children.push(n.label, n.statement);
			break;
		}
		case ts.SyntaxKind.ThrowStatement: {
			const n = node as ts.ThrowStatement;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.TryStatement: {
			const n = node as ts.TryStatement;
			pushall(children, n.tryBlock, n.catchClause, n.finallyBlock);
			break;
		}
		case ts.SyntaxKind.VariableDeclaration: {
			const n = node as ts.VariableDeclaration;
			pushall(children, n.name, n.type, n.initializer);
			break;
		}
		case ts.SyntaxKind.VariableDeclarationList: {
			const n = node as ts.VariableDeclarationList;
			children.push(...n.declarations);
			break;
		}
		case ts.SyntaxKind.FunctionDeclaration: {
			const n = node as ts.FunctionDeclaration;
			pushall(children, n.name, n.body, n.type, ...n.parameters);
			if (n.typeParameters) {
				children.push(...n.typeParameters);
			}
			break;
		}
		case ts.SyntaxKind.ClassDeclaration: {
			const n = node as ts.ClassDeclaration;
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
			const n = node as ts.InterfaceDeclaration;
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
			const n = node as ts.TypeAliasDeclaration;
			children.push(n.name, n.type);
			if (n.typeParameters) {
				children.push(...n.typeParameters);
			}
			break;
		}
		case ts.SyntaxKind.EnumDeclaration: {
			const n = node as ts.EnumDeclaration;
			children.push(n.name, ...n.members);
			break;
		}
		case ts.SyntaxKind.ModuleDeclaration: {
			const n = node as ts.ModuleDeclaration;
			pushall(children, n.name, n.body);
			break;
		}
		case ts.SyntaxKind.ModuleBlock: {
			const n = node as ts.ModuleBlock;
			children.push(...n.statements);
			break;
		}
		case ts.SyntaxKind.CaseBlock: {
			const n = node as ts.CaseBlock;
			children.push(...n.clauses);
			break;
		}
		case ts.SyntaxKind.NamespaceExportDeclaration: {
			const n = node as ts.NamespaceExportDeclaration;
			yield* walkMostAST(n.name);
			break;
		}
		case ts.SyntaxKind.ImportEqualsDeclaration: {
			const n = node as ts.ImportEqualsDeclaration;
			children.push(n.name, n.moduleReference);
			break;
		}
		case ts.SyntaxKind.ImportDeclaration: {
			const n = node as ts.ImportDeclaration;
			pushall(children, n.importClause, n.moduleSpecifier);
			break;
		}
		case ts.SyntaxKind.ImportClause: {
			const n = node as ts.ImportClause;
			pushall(children, n.name, n.namedBindings);
			break;
		}
		case ts.SyntaxKind.NamespaceImport: {
			const n = node as ts.NamespaceImport;
			children.push(n.name);
			break;
		}
		case ts.SyntaxKind.NamedImports: {
			const n = node as ts.NamedImports;
			children.push(...n.elements);
			break;
		}
		case ts.SyntaxKind.ImportSpecifier: {
			const n = node as ts.ImportSpecifier;
			pushall(children, n.propertyName, n.name);
			break;
		}
		case ts.SyntaxKind.ExportAssignment: {
			const n = node as ts.ExportAssignment;
			pushall(children, n.name, n.expression);
			break;
		}
		case ts.SyntaxKind.ExportDeclaration: {
			const n = node as ts.ExportDeclaration;
			pushall(children, n.exportClause, n.moduleSpecifier, n.name);
			break;
		}
		case ts.SyntaxKind.NamedExports: {
			const n = node as ts.NamedExports;
			children.push(...n.elements);
			break;
		}
		case ts.SyntaxKind.ExportSpecifier: {
			const n = node as ts.ExportSpecifier;
			pushall(children, n.propertyName, n.name);
			break;
		}
		case ts.SyntaxKind.MissingDeclaration: {
			const n = node as ts.MissingDeclaration;
			if (n.name) {
				children.push(n.name);
			}
			break;
		}
		case ts.SyntaxKind.ExternalModuleReference: {
			const n = node as ts.ExternalModuleReference;
			pushall(children, n.expression);
			break;
		}
		case ts.SyntaxKind.JsxElement: {
			const n = node as ts.JsxElement;
			children.push(n.openingElement, n.closingElement, ...n.children);
			break;
		}
		case ts.SyntaxKind.JsxSelfClosingElement: {
			const n = node as ts.JsxSelfClosingElement;
			yield* walkMostAST(n.tagName);
			for (const property of n.attributes.properties) {
				yield* walkMostAST(property);
			}
			break;
		}
		case ts.SyntaxKind.JsxOpeningElement: {
			const n = node as ts.JsxOpeningElement;
			yield* walkMostAST(n.tagName);
			yield* walkMostAST(n.attributes);
			break;
		}
		case ts.SyntaxKind.JsxClosingElement: {
			const n = node as ts.JsxClosingElement;
			children.push(n.tagName);
			break;
		}
		case ts.SyntaxKind.JsxAttribute: {
			const n = node as ts.JsxAttribute;
			pushall(children, n.name, n.initializer);
			break;
		}
		case ts.SyntaxKind.JsxSpreadAttribute: {
			const n = node as ts.JsxSpreadAttribute;
			children.push(n.expression);
			break;
		}
		case ts.SyntaxKind.JsxExpression: {
			const n = node as ts.JsxExpression;
			if (n.expression) {
				children.push(n.expression);
			}
			break;
		}
		case ts.SyntaxKind.CaseClause: {
			const n = node as ts.CaseClause;
			children.push(n.expression, ...n.statements);
			break;
		}
		case ts.SyntaxKind.DefaultClause: {
			const n = node as ts.DefaultClause;
			children.push(...n.statements);
			break;
		}
		case ts.SyntaxKind.HeritageClause: {
			const n = node as ts.HeritageClause;
			if (n.types) {
				children.push(...n.types);
			}
			break;
		}
		case ts.SyntaxKind.CatchClause: {
			const n = node as ts.CatchClause;
			children.push(n.variableDeclaration, n.block);
			break;
		}
		case ts.SyntaxKind.PropertyAssignment: {
			const n = node as ts.PropertyAssignment;
			children.push(n.name, n.initializer);
			break;
		}
		case ts.SyntaxKind.ShorthandPropertyAssignment: {
			const n = node as ts.ShorthandPropertyAssignment;
			pushall(children, n.name, n.objectAssignmentInitializer);
			break;
		}
		case ts.SyntaxKind.EnumMember: {
			const n = node as ts.EnumMember;
			pushall(children, n.name, n.initializer);
			break;
		}
		case ts.SyntaxKind.SourceFile: {
			const n = node as ts.SourceFile;
			children.push(...n.statements);
			break;
		}
		case ts.SyntaxKind.JSDocTypeExpression: {
			const n = node as ts.JSDocTypeExpression;
			children.push(n.type);
			break;
		}
		case ts.SyntaxKind.JSDocArrayType: {
			const n = node as ts.JSDocArrayType;
			children.push(n.elementType);
			break;
		}
		case ts.SyntaxKind.JSDocUnionType: {
			const n = node as ts.JSDocUnionType;
			children.push(...n.types);
			break;
		}
		case ts.SyntaxKind.JSDocTupleType: {
			const n = node as ts.JSDocTupleType;
			children.push(...n.types);
			break;
		}
		case ts.SyntaxKind.JSDocNullableType: {
			const n = node as ts.JSDocNullableType;
			children.push(n.type);
			break;
		}
		case ts.SyntaxKind.JSDocNonNullableType: {
			const n = node as ts.JSDocNonNullableType;
			children.push(n.type);
			break;
		}
		case ts.SyntaxKind.JSDocRecordType: {
			const n = node as ts.JSDocRecordType;
			children.push(n.literal);
			break;
		}
		case ts.SyntaxKind.JSDocRecordMember: {
			const n = node as ts.JSDocRecordMember;
			pushall(children, n.name, n.type, n.initializer);
			break;
		}
		case ts.SyntaxKind.JSDocTypeReference: {
			const n = node as ts.JSDocTypeReference;
			children.push(n.name, ...n.typeArguments);
			break;
		}
		case ts.SyntaxKind.JSDocOptionalType: {
			const n = node as ts.JSDocOptionalType;
			children.push(n.type);
			break;
		}
		case ts.SyntaxKind.JSDocFunctionType: {
			const n = node as ts.JSDocFunctionType;
			pushall(children, n.name, n.type, ...n.parameters);
			if (n.typeParameters) {
				children.push(...n.typeParameters);
			}
			break;
		}
		case ts.SyntaxKind.JSDocVariadicType: {
			const n = node as ts.JSDocVariadicType;
			children.push(n.type);
			break;
		}
		case ts.SyntaxKind.JSDocConstructorType: {
			const n = node as ts.JSDocConstructorType;
			children.push(n.type);
			break;
		}
		case ts.SyntaxKind.JSDocThisType: {
			const n = node as ts.JSDocThisType;
			children.push(n.type);
			break;
		}
		case ts.SyntaxKind.JSDocComment: {
			const n = node as ts.JSDoc;
			if (n.tags) {
				children.push(...n.tags);
			}
			break;
		}
		case ts.SyntaxKind.JSDocTag: {
			const n = node as ts.JSDocTag;
			children.push(n.tagName);
			break;
		}
		case ts.SyntaxKind.JSDocParameterTag: {
			const n = node as ts.JSDocParameterTag;
			pushall(children, n.typeExpression, n.postParameterName, n.parameterName);
			if (n.preParameterName) {
				children.push(n.preParameterName);
			}
			break;
		}
		case ts.SyntaxKind.JSDocReturnTag: {
			const n = node as ts.JSDocReturnTag;
			children.push(n.typeExpression);
			break;
		}
		case ts.SyntaxKind.JSDocTypeTag: {
			const n = node as ts.JSDocTypeTag;
			children.push(n.typeExpression);
			break;
		}
		case ts.SyntaxKind.JSDocTemplateTag: {
			const n = node as ts.JSDocTemplateTag;
			children.push(...n.typeParameters);
			break;
		}
		case ts.SyntaxKind.JSDocTypedefTag: {
			const n = node as ts.JSDocTypedefTag;
			pushall(children, n.fullName, n.typeExpression, n.jsDocTypeLiteral);
			if (n.name) {
				children.push(n.name);
			}
			break;
		}
		case ts.SyntaxKind.JSDocPropertyTag: {
			const n = node as ts.JSDocPropertyTag;
			children.push(n.name, n.typeExpression);
			break;
		}
		case ts.SyntaxKind.JSDocTypeLiteral: {
			const n = node as ts.JSDocTypeLiteral;
			if (n.jsDocPropertyTags) {
				children.push(...n.jsDocPropertyTags);
			}
			if (n.jsDocTypeTag) {
				children.push(n.jsDocTypeTag);
			}
			break;
		}
		case ts.SyntaxKind.JSDocLiteralType: {
			const n = node as ts.JSDocLiteralType;
			children.push(n.literal);
			break;
		}
		case ts.SyntaxKind.SyntaxList: {
			const n = node as ts.SyntaxList;
			children.push(...n._children);
			break;
		}
		default:
			break;
	}
	for (const child of children) {
		if (child) {
			yield* walkMostAST(child);
		}
	}
}

function pushall<T>(arr: T[], ...elems: (T | null | undefined)[]): number {
	for (const e of elems) {
		if (e) {
			arr.push(e);
		}
	}
	return arr.length;
}
