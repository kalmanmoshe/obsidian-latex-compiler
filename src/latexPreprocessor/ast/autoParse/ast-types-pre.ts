import { RenderInfo } from '../typs/info-specs';

/**
 * Parse the string into an AST.
 */

let rawParse: (str: string) => Ast;

import('@unified-latex/unified-latex-util-parse')
	.then((module) => {
		rawParse = module.parse;
	})
	.catch((error: unknown) => {
		console.error('Failed to load unified-latex parser:', error);
	});
	
import {
	Root as RootClass,
	String as StringClass,
	Whitespace as WhitespaceClass,
	Parbreak as ParbreakClass,
	Comment as CommentClass,
	Macro as MacroClass,
	Environment as EnvironmentClass,
	Argument as ArgumentClass,
	DisplayMath as DisplayMathClass,
	Group as GroupClass,
	InlineMath as InlineMathClass,
	Verb as VerbClass,
	VerbatimEnvironment as VerbatimEnvironmentClass,
	Ast as AstClass,
	Node as NodeClass,
	BaseNode as BaseNodeClass,
	isDependencyMacroType,
	DependencyMacro,
} from '../typs/astNodes';
import { findEnvironmentArgs } from '../verifyEnvironmentWrap';

// Abstract nodes
interface BaseNode {
	type: string;
	_renderInfo?: RenderInfo;
	position?: {
		start: { offset: number; line: number; column: number };
		end: { offset: number; line: number; column: number };
	};
}

interface ContentNode extends BaseNode {
	content: Node[];
}

// Actual nodes
interface Root extends ContentNode {
	type: 'root';
}
interface String extends BaseNode {
	type: 'string';
	content: string;
}

interface Whitespace extends BaseNode {
	type: 'whitespace';
}

interface Parbreak extends BaseNode {
	type: 'parbreak';
}

interface Comment extends BaseNode {
	type: 'comment';
	content: string;
	sameline?: boolean;
	suffixParbreak?: boolean;
	leadingWhitespace?: boolean;
}

interface Macro extends BaseNode {
	type: 'macro';
	content: string;
	escapeToken?: string;
	args?: Argument[];
}

interface Environment extends ContentNode {
	type: 'environment' | 'mathenv';
	env: string;
	args?: Argument[];
}

interface VerbatimEnvironment extends BaseNode {
	type: 'verbatim';
	env: string;
	content: string;
}

interface DisplayMath extends ContentNode {
	type: 'displaymath';
}

interface Group extends ContentNode {
	type: 'group';
}

interface InlineMath extends ContentNode {
	type: 'inlinemath';
}

interface Verb extends BaseNode {
	type: 'verb';
	env: string;
	escape: string;
	content: string;
}

interface Argument extends ContentNode {
	type: 'argument';
	openMark: string;
	closeMark: string;
}

type Node =
	| Root
	| String
	| Whitespace
	| Parbreak
	| Comment
	| Macro
	| Environment
	| VerbatimEnvironment
	| InlineMath
	| DisplayMath
	| Group
	| Verb;

type Ast = Node | Argument | Node[];

function isNodeClassArray(content: unknown[]): content is NodeClass[] {
	return content.every((node) => node instanceof BaseNodeClass);
}

function isArgumentClassArray(content: unknown[]): content is ArgumentClass[] {
	return content.every((node) => node instanceof ArgumentClass);
}

function validateNodeContent(ast: ContentNode, errorMessagePrefix: string): NodeClass[] {
	const content = ast.content.map(migrateToClassStructure);
	if (!isNodeClassArray(content)) {
		throw new Error(
			errorMessagePrefix +
				' node content must be an array of BaseNode instances/children, got: ' +
				content.toString(),
		);
	}
	return content;
}

function migrateToClassStructure(ast: Ast): AstClass {
	if (Array.isArray(ast)) {
		const nodes: NodeClass[] = ast.map(migrateToClassStructure).map((node) => {
			if (Array.isArray(node) || node instanceof ArgumentClass) {
				throw new Error('Array of nodes must contain only BaseNode instances/children');
			}
			return node;
		});
		return nodes;
	}
	switch (ast.type) {
		case 'root':
			return new RootClass(validateNodeContent(ast, 'root'), ast._renderInfo, ast.position);
		case 'string':
			return new StringClass(ast.content, ast._renderInfo, ast.position);
		case 'whitespace':
			return new WhitespaceClass(ast._renderInfo, ast.position);
		case 'parbreak':
			return new ParbreakClass(ast._renderInfo, ast.position);
		case 'comment':
			return new CommentClass(
				ast.content,
				ast.sameline,
				!ast.suffixParbreak, // the wording from the pakeg is awkwrd
				ast.leadingWhitespace,
				ast._renderInfo,
				ast.position,
			);
		case 'macro': {
			const macroArgs = ast.args?.map(migrateToClassStructure);
			if (macroArgs && !isArgumentClassArray(macroArgs)) {
				throw new Error('macro node args must be an array of Arguments');
			}

			const isDependency =
				macroArgs !== undefined &&
				macroArgs.length === 1 &&
				isDependencyMacroType(ast.content);

			if (isDependency) {
				return new DependencyMacro(
					ast.content,
					false,
					ast.escapeToken,
					macroArgs,
					ast._renderInfo,
					ast.position,
				);
			}

			return new MacroClass(
				ast.content,
				ast.escapeToken,
				macroArgs,
				ast._renderInfo,
				ast.position,
			);
		} case 'environment': {
			const envArgs = ast.args?.map(migrateToClassStructure);
			if (envArgs && !isArgumentClassArray(envArgs)) {
				throw new Error('environment node args must be an array of Arguments');
			}
			const newEnv = new EnvironmentClass(
				ast.type,
				ast.env,
				validateNodeContent(ast, 'anv'),
				envArgs,
				ast._renderInfo,
				ast.position,
			);
			setEnvironmentArguments(newEnv);
			return newEnv;
		} case 'verbatim':
			return new VerbatimEnvironmentClass(
				ast.env,
				ast.content,
				ast._renderInfo,
				ast.position,
			);
		case 'displaymath':
			return new DisplayMathClass(
				validateNodeContent(ast, 'displaymath'),
				ast._renderInfo,
				ast.position,
			);
		case 'inlinemath':
			return new InlineMathClass(
				validateNodeContent(ast, 'inlinemath'),
				ast._renderInfo,
				ast.position,
			);
		case 'group':
			return new GroupClass(validateNodeContent(ast, 'group'), ast._renderInfo, ast.position);
		case 'argument':
			return new ArgumentClass(
				ast.openMark,
				ast.closeMark,
				validateNodeContent(ast, 'argument'),
				ast._renderInfo,
				ast.position,
			);
		case 'verb':
			return new VerbClass(ast.env, ast.escape, ast.content, ast._renderInfo, ast.position);
		default:
			throw new Error(`Unknown node type: ${ast.type}`);
	}
}

function setEnvironmentArguments(env: EnvironmentClass) {
	const hasArgs = env.args != undefined;
	if (hasArgs) return;

	const firstNode = env.content.find((node) => !(node instanceof WhitespaceClass));
	if (!firstNode || !(firstNode.isString() && firstNode.content == '[')) return;

	const args = findEnvironmentArgs(env.content);
	env.args = args;
}

export function parse(latex: string) {
	const autoAst = rawParse(latex);
	const classAst = migrateToClassStructure(autoAst);
	if (!(classAst instanceof RootClass)) throw new Error('Root not found');
	return classAst;
}