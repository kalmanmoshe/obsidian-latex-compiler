import { findNodeWithPath } from '../findNode';
import { EnvRenderInfo, RenderInfo } from './info-specs';

export type GenericAst = GenericNode | GenericNode[];

export interface GenericNode {
	[x: string]: any;
	type: string;
	renderInfo?: object;
}

type Position = {
	start: { offset: number; line: number; column: number };
	end: { offset: number; line: number; column: number };
};

/**
 * Represents the base class for all AST (Abstract Syntax Tree) nodes.
 * Provides common properties and methods shared across different node types.
 *
 * @abstract
 * @property {string} type - The type identifier of the node.
 * @property {RenderInfo | undefined} renderInfo - Optional rendering information associated with the node.
 * @property {Position | undefined} position - Optional position information of the node within the source.
 */
export abstract class BaseNode {
	abstract readonly type: string;
	renderInfo?: RenderInfo;
	position?: Position;

	constructor(renderInfo?: RenderInfo, position?: Position) {
		if (renderInfo) this.renderInfo = renderInfo;
		if (position) this.position = position;
	}
	
	/**
	 * Creates a deep copy of the current node instance. Must be implemented by subclasses.
	 */
	abstract clone(): this;
	/**
	 * Type guard to check if the current node is an instance of the `Macro` class
	 * @returns {boolean} - `true` if the node is a `Macro`, otherwise `false`.
	 */
	isMacro(): this is Macro {
		return this instanceof Macro;
	}

	/**
	 * Searches recursively within the node tree for the first node that matches the given predicate.
	 * @param {(node: Node) => boolean} predicate - A function to test each node. Returns `true` for matching nodes.
	 * @returns {Node[] | undefined} - An array of nodes matching the predicate, or `undefined` if no match is found.
	 */
	deepFind(predicate: (node: Node) => boolean) {
		return findNodeWithPath<BaseNode>(this, predicate)?.node as (Node | Argument) | null;
	}
	
	deepFindWithPath(predicate: (node: Node) => boolean) {
		return findNodeWithPath<BaseNode>(this, predicate);
	}

	isContent(): this is ContentNode {
		return this instanceof ContentNode;
	}

	hasArguments(): this is Macro | Environment {
		return this.isMacro() || this instanceof Environment;
	}

	isString(): this is String {
		return this instanceof String;
	}

	isWhitespaceLike(): this is Whitespace | Parbreak | Comment {
		return this instanceof Whitespace || this instanceof Parbreak || this instanceof Comment;
	}

	isContentNode(): this is ContentNode {
		return this instanceof ContentNode;
	}

	hasChildren(): boolean {
		return this.isMacro() || this.isContentNode();
	}

	getNodeChildren(): Node[] {
		const children = this.getChildren();
		if (children[0] instanceof Argument) {
			return children
				.map((child) => (child instanceof Argument ? child.content : child))
				.flat();
		}
		return children as Node[];
	}

	getChildren(): Node[] | Argument[] {
		if (this.isMacro() && this.args) {
			return this.args;
		} else if (this.isContentNode()) {
			return this.content;
		}
		return [];
	}

	getMacroDef(): null | string {
		if (!this.isMacro()) return null;
		if (this.content !== 'def') return null;
		return this.content;
	}
}

export abstract class StringNode extends BaseNode {
	content: string;
	constructor(
		content: string,
		renderInfo?: RenderInfo,
		position?: typeof BaseNode.prototype.position,
	) {
		super(renderInfo, position);
		this.content = content;
	}
	toString(): string {
		return this.content;
	}
}

export abstract class ContentNode extends BaseNode {
	content: Node[];
	constructor(
		content: Node[],
		renderInfo?: RenderInfo,
		position?: typeof BaseNode.prototype.position,
	) {
		super(renderInfo, position);
		this.content = content;
	}

	clone(): this {
		const clone = new (this.constructor as new (...args: any[]) => this)(
			this.content.map((node) => node.clone()),
			this.renderInfo,
			clonePosition(this.position),
		);
		Object.assign(clone, this);
		return clone;
	}
}

// Actual nodes
export class Root extends ContentNode {
	readonly type = 'root';

	toString(): string {
		return this.content.map((node) => node.toString()).join('');
	}

	clone(): this {
		return new Root(
			this.content.map((node) => node.clone()),
			this.renderInfo,
			clonePosition(this.position),
		) as this;
	}
}

export class String extends StringNode {
	readonly type = 'string';
	getNumber() {
		return Number(this.content);
	}
	clone(): this {
		const clone = new String(
			this.content,
			this.renderInfo,
			clonePosition(this.position),
		) as this;

		return clone;
	}
}

export class Whitespace extends BaseNode {
	readonly type = 'whitespace';

	toString(): string {
		if (!this.position?.start || !this.position?.end) {
			return ' ';
		}

		const { start, end } = this.position;

		// Single-line whitespace
		if (start.line === end.line) {
			return ' '.repeat(Math.max(0, end.column - start.column));
		}

		let result = '';

		// First line: from start.column to end of line
		// We don't know the original line length, so just preserve
		// the indentation part.
		result += ' '.repeat(Math.max(0, start.column - 1));

		// Intermediate full blank lines
		for (let line = start.line; line < end.line; line++) {
			result += '\n';
		}

		// Last line indentation
		result += ' '.repeat(Math.max(0, end.column - 1));

		return result;
	}

	clone(): this {
		const clone = new Whitespace(this.renderInfo, clonePosition(this.position)) as this;

		return clone;
	}
}

export class Parbreak extends BaseNode {
	type = 'parbreak';
	constructor(renderInfo?: RenderInfo, position?: typeof BaseNode.prototype.position) {
		super(renderInfo, position);
	}
	toString(): string {
		return '\n';
	}
	clone(): this {
		const clone = new Parbreak(this.renderInfo, clonePosition(this.position)) as this;
		return clone;
	}
}

export class Comment extends StringNode {
	type = 'comment';
	sameline?: boolean;
	suffixLinebreak?: boolean;
	leadingWhitespace?: boolean;
	constructor(
		content: string,
		sameline?: boolean,
		suffixLinebreak?: boolean,
		leadingWhitespace?: boolean,
		renderInfo?: RenderInfo,
		position?: typeof BaseNode.prototype.position,
	) {
		super(content, renderInfo, position);
		if (sameline !== undefined) this.sameline = sameline;
		if (suffixLinebreak !== undefined) this.suffixLinebreak = suffixLinebreak;
		if (leadingWhitespace !== undefined) this.leadingWhitespace = leadingWhitespace;
	}

	toString(): string {
		const leading = this.sameline && this.leadingWhitespace ? ' ' : '';
		const suffix = this.suffixLinebreak ? '\n' : '';

		return `${leading}%${this.content}${suffix}`;
	}

	clone(): this {
		const clone = new Comment(
			this.content,
			this.sameline,
			this.suffixLinebreak,
			this.leadingWhitespace,
			this.renderInfo,
			clonePosition(this.position),
		) as this;

		return clone;
	}
}

export class Macro extends StringNode {
	type = 'macro';
	escapeToken?: string;
	args?: Argument[];
	constructor(
		content: string,
		escapeToken?: string,
		args?: Argument[],
		renderInfo?: RenderInfo,
		position?: Position,
	) {
		renderInfo = formatRenderInfo(content, renderInfo);
		super(content, renderInfo, position);
		this.content = content;
		if (escapeToken) this.escapeToken = escapeToken;
		if (args) this.args = args;
	}

	toStringArgsContent(): string {
		if (!this.args) {
			throw new Error('Macro has no arguments to stringify');
		}
		return this.args.map((arg) => arg.toStringContent()).join('');
	}

	toStringArgs(): string {
		if (!this.args) {
			throw new Error('Macro has no arguments to stringify');
		}
		return this.args.map((arg) => arg.toString()).join('');
	}

	toString(): string {
		const prefix = this.renderInfo?.escapeToken || '';
		return (
			prefix + this.content + (this.args ? this.toStringArgs() : '') // +
			//(this.renderInfo?.breakAfter ? '\n' : '')
		);
	}

	clone(): this {
		const clone = new Macro(
			this.content,
			this.escapeToken,
			this.args?.map((arg) => arg.clone()),
			this.renderInfo,
			clonePosition(this.position),
		) as this;

		return clone;
	}
}

export const DependencyMacroTypes = ['input', 'include', 'import', 'subfile'] as const;

export type DependencyMacroType = (typeof DependencyMacroTypes)[number];

export function isDependencyMacroType(content: string): content is DependencyMacroType {
	return DependencyMacroTypes.includes(content as DependencyMacroType);
}

export class DependencyMacro extends Macro {
	autoUse: boolean;

	constructor(
		content: string,
		autoUse: boolean,
		escapeToken?: string,
		args?: Argument[],
		renderInfo?: RenderInfo,
		position?: Position,
	) {
		renderInfo = formatRenderInfo(content, renderInfo);
		super(content, escapeToken, args, renderInfo, position);
		this.autoUse = autoUse;
	}

	clone(): this {
		const clone = new DependencyMacro(
			this.content,
			this.autoUse,
			this.escapeToken,
			this.args?.map((arg) => arg.clone()),
			this.renderInfo,
			clonePosition(this.position),
		) as this;

		return clone;
	}
}

const macros_Not_To_escape_Regex = /(_|\^)/;

function formatRenderInfo(content: string, info?: RenderInfo) {
	const defConfig = getDefaultMacroRenderInfoConfig(content);
	if (!info) {
		return defConfig;
	}
	// Overwrite default config with info
	return Object.assign({}, defConfig, info);
}

const getDefaultMacroRenderInfoConfig = (content: string): RenderInfo | undefined => {
	let info: RenderInfo = {};
	if (!macros_Not_To_escape_Regex.test(content)) {
		info.escapeToken = '\\';
	}
	if (content.match(/pgf/)) {
		info.pgfkeysArgs = true;
	}
	if (content.match(/input|documentclass/)) info.breakAfter = true;
	return Object.keys(info).length === 0 ? undefined : info;
};

export class Environment extends ContentNode {
	readonly type: 'environment' | 'mathenv';
	env: string;
	args?: Argument[];
	renderInfo?: EnvRenderInfo;

	constructor(
		type: 'environment' | 'mathenv',
		env: string,
		content: Node[],
		args?: Argument[],
		renderInfo?: RenderInfo,
		position?: Position,
	) {
		super(content, renderInfo, position);
		this.type = type;
		this.env = env;
		if (args) this.args = args;
	}

	clone(): this {
		const clone = new Environment(
			this.type,
			this.env,
			this.content.map((node) => node.clone()),
			this.args?.map((arg) => arg.clone()),
			this.renderInfo,
			clonePosition(this.position),
		) as this;

		return clone;
	}

	toString(): string {
		let string = `\\begin{${this.env}}`;
		if (this.args) {
			string += this.args.map((arg) => arg.toString()).join('');
		}
		string +=
			//'\n' +
			indentString(this.content.map((node) => node.toString()).join('')); // +
		//'\n';
		string += `\\end{${this.env}}\n`;
		return string;
	}
}

function indentString(input: string, indent: string = '\t'): string {
	return input
		.split('\n')
		.map((line) => indent + line)
		.join('\n');
}

export class VerbatimEnvironment extends StringNode {
	readonly type = 'verbatim';
	env: string;
	constructor(
		env: string,
		content: string,
		renderInfo?: RenderInfo,
		position?: typeof BaseNode.prototype.position,
	) {
		super(content, renderInfo, position);
		this.env = env;
	}
	toString(): string {
		return `\\begin{${this.env}}${this.content}\\end{${this.env}}`;
	}
	clone(): this {
		const clone = new VerbatimEnvironment(
			this.env,
			this.content,
			this.renderInfo,
			clonePosition(this.position),
		) as this;

		return clone;
	}
}

export class DisplayMath extends ContentNode {
	type = 'displaymath';

	toString(): string {
		return '$$' + this.content.map((node) => node.toString()).join('') + '$$';
	}
}

export class Group extends ContentNode {
	readonly type = 'group';
	toString(): string {
		return `{${this.content.map((node) => node.toString()).join('')}}`;
	}
}

export class InlineMath extends ContentNode {
	readonly type = 'inlinemath';
	toString(): string {
		return '$' + this.content.map((node) => node.toString()).join('') + '$';
	}
}

export class Verb extends StringNode {
	readonly type = 'verb';
	env: string;
	escape: string;
	constructor(
		env: string,
		escape: string,
		content: string,
		renderInfo?: RenderInfo,
		position?: typeof BaseNode.prototype.position,
	) {
		super(content, renderInfo, position);
		this.env = env;
		this.escape = escape;
	}

	toString(): string {
		return `\\${this.env}${this.escape}${this.content}${this.escape}`;
	}

	clone(): this {
		const clone = new Verb(
			this.env,
			this.escape,
			this.content,
			this.renderInfo,
			clonePosition(this.position),
		) as this;

		return clone;
	}
}

export class Argument extends ContentNode {
	readonly type = 'argument';
	openMark: string;
	closeMark: string;
	constructor(
		openMark: string,
		closeMark: string,
		content: Node[],
		renderInfo?: RenderInfo,
		position?: typeof BaseNode.prototype.position,
	) {
		super(content, renderInfo, position);
		this.openMark = openMark;
		this.closeMark = closeMark;
	}

	clone(): this {
		const clone = new (this.constructor as new (...args: any[]) => this)(
			this.openMark,
			this.closeMark,
			this.content.map((node) => node.clone()),
			this.renderInfo,
			clonePosition(this.position),
		);

		return clone;
	}

	toString(): string {
		let string = this.openMark + this.toStringContent() + this.closeMark;
		return string;
	}

	toStringContent(): string {
		return this.content.map((node) => node.toString()).join('');
	}
}

export type Node =
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

export type Ast = Node | Argument | Node[];

function clonePosition(position?: Position): Position | undefined {
	if (!position) return undefined;
	return {
		start: { ...position.start },
		end: { ...position.end },
	};
}
