import {
	isWhitespace,
	readArgumentEnd,
	readControlSequence,
	readEnvironmentName,
	readLiteralEnd,
	skipComment,
	skipWhitespaceAndComments,
} from '../latexLexing';
import {
	Argument,
	Comment,
	DependencyMacro,
	Environment,
	Group,
	isDependencyMacroType,
	Macro,
	Node,
	Root,
	String,
	Whitespace,
} from './typs/astNodes';

export const preambleMacroArguments = new Map([
	['documentclass', '[{'],
	['usepackage', '[{'],
	['usetikzlibrary', '{'],
	['bibliography', '{'],
	['pgfplotsset', '{'],
]);

interface Frame {
	content: Node[];
	open: string;
	close: string;
	env?: string;
}

interface LatexInputReference {
	type: 'input' | 'include';
	path: string;
	pathStart: number;
	pathEnd: number;
}

const textRun = /[^\\{}$%[\] \t\r\n]+/y;
const blankLines = /(\r\n|\r(?!\n)|\n)(?:[ \t]*(?:\r\n|\r(?!\n)|\n))+/;

// Read the structure the TikZ wrapper needs while preserving literal TeX.
export function parse(latex: string) {
	const root: Frame = { content: [], open: '', close: '' };
	const stack = [root];
	const inputReferences: LatexInputReference[] = [];
	let inputArgumentEnd = 0;
	let frame = root;
	let offset = 0;

	function openFrame(open: string, close: string, env?: string) {
		frame = { content: [], open, close, env };
		stack.push(frame);
	}

	function closeFrame(close: string) {
		const node = frame.env
			? new Environment(
					'environment',
					frame.env,
					frame.content,
					undefined,
					undefined,
					undefined,
					[frame.open, close],
				)
			: new Group(frame.content, frame.open, close);
		stack.pop();
		frame = stack[stack.length - 1];
		frame.content.push(node);
	}

	function unwindTo(index: number) {
		frame = stack[index];
		for (let i = index + 1; i < stack.length; i++) {
			const unclosed = stack[i];
			frame.content.push(new String(unclosed.open));
			for (const node of unclosed.content) frame.content.push(node);
		}
		stack.length = index + 1;
	}

	while (offset < latex.length) {
		const start = offset;
		const char = latex[offset++];
		if (isWhitespace(char)) {
			while (isWhitespace(latex[offset])) offset++;
			// The previous parser serialized paragraph breaks as one line break.
			// TeX would otherwise insert \par in the middle of paths and arguments.
			const whitespace = latex.slice(start, offset).replace(blankLines, '$1');
			frame.content.push(new Whitespace(whitespace));
		} else if (char === '%') {
			offset = skipComment(latex, offset);
			frame.content.push(new Comment(latex.slice(start + 1, offset)));
		} else if (char === '\\') {
			const control = readControlSequence(latex, start);
			if (!control) {
				frame.content.push(new String(char));
				continue;
			}
			offset = control.end;
			const literalEnd = readLiteralEnd(latex, control);
			if (literalEnd !== undefined) {
				offset = literalEnd;
				frame.content.push(new String(latex.slice(start, offset)));
				continue;
			}
			if (
				start >= inputArgumentEnd &&
				(control.name === 'input' || control.name === 'include')
			) {
				const argumentStart = skipWhitespaceAndComments(latex, offset);
				if (latex[argumentStart] !== '{') {
					throw new Error(
						'\\' + control.name + ' at offset ' + start + ' has no valid required argument',
					);
				}
				const argumentEnd = readArgumentEnd(latex, argumentStart);
				if (argumentEnd === undefined) {
					throw new Error('Unterminated LaTeX argument starting at offset ' + argumentStart);
				}
				inputReferences.push({
					type: control.name,
					path: latex.slice(argumentStart + 1, argumentEnd - 1),
					pathStart: argumentStart + 1,
					pathEnd: argumentEnd - 1,
				});
				// Keep parsing the argument for the AST, but treat its contents as a single path.
				inputArgumentEnd = argumentEnd;
			}
			if (control.name === 'begin' || control.name === 'end') {
				const env = readEnvironmentName(latex, offset);
				if (env) {
					const mark = latex.slice(start, env.end);
					if (control.name === 'begin') {
						openFrame(mark, '', env.name);
						offset = env.end;
						continue;
					}

					// An unmatched math delimiter must not hide an enclosing environment's end.
					let index = stack.length - 1;
					while (stack[index].close && stack[index].close !== '}') index--;
					if (stack[index].env === env.name) {
						unwindTo(index);
						closeFrame(mark);
						offset = env.end;
						continue;
					}
				}
			}
			const mark = latex.slice(start, offset);
			if (mark === frame.close) {
				closeFrame(mark);
			} else if (mark === '\\(' || mark === '\\[') {
				openFrame(mark, mark === '\\(' ? '\\)' : '\\]');
			} else {
				frame.content.push(new Macro(control.name, '\\'));
			}
		} else if (char === '$') {
			const mark = frame.close !== '$' && latex[offset] === '$' ? '$$' : '$';
			offset = start + mark.length;
			if (mark === frame.close) {
				closeFrame(mark);
			} else {
				openFrame(mark, mark);
			}
		} else if (char === '{') {
			openFrame('{', '}');
		} else if (char === '}') {
			// A macro definition can contain an opening environment or math delimiter.
			let index = stack.length - 1;
			while (index > 0 && stack[index].close !== '}') index--;
			if (index > 0) {
				unwindTo(index);
				closeFrame(char);
			} else {
				frame.content.push(new String(char));
			}
		} else {
			textRun.lastIndex = start;
			const text = textRun.exec(latex)?.[0] ?? char;
			offset = start + text.length;
			frame.content.push(new String(text));
		}
	}

	// Leave incomplete constructs in the source so TeX can report them.
	unwindTo(0);
	return { root: new Root(attachPreambleArguments(root.content)), inputReferences };
}

function attachPreambleArguments(content: Node[]): Node[] {
	const result: Node[] = [];
	for (let index = 0; index < content.length; index++) {
		const node = content[index];
		if (!node.isMacro()) {
			result.push(node);
			continue;
		}
		const signature =
			preambleMacroArguments.get(node.content) ??
			(node.content === 'input' || node.content === 'include' ? '{' : '');
		if (!signature) {
			result.push(node);
			continue;
		}
		const args: Argument[] = [];
		for (const mark of signature) {
			let start = index + 1;
			while (content[start]?.isWhitespaceLike()) start++;
			const prefix = content.slice(index + 1, start).join('');
			const argument = content[start];
			if (mark === '{') {
				if (!(argument instanceof Group) || argument.openMark !== '{') break;
				args.push(new Argument('{', '}', argument.content, undefined, undefined, prefix));
				index = start;
			} else if (argument?.isString() && argument.content === '[') {
				const end = findMatchingBracket(content, start);
				if (end === -1) break;
				args.push(
					new Argument(
						'[',
						']',
						content.slice(start + 1, end),
						undefined,
						undefined,
						prefix,
					),
				);
				index = end;
			}
		}
		if (args.length === 1 && isDependencyMacroType(node.content)) {
			result.push(new DependencyMacro(node.content, false, node.escapeToken, args));
		} else {
			if (args.length) node.args = args;
			result.push(node);
		}
	}
	return result;
}

export function findMatchingBracket(content: Node[], start: number): number {
	let depth = 1;
	for (let i = start + 1; i < content.length; i++) {
		const node = content[i];
		if (!node.isString()) continue;
		if (node.content === '[') depth++;
		if (node.content === ']' && --depth === 0) return i;
	}
	return -1;
}
