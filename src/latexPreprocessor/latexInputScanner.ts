export interface LatexInputReference {
	type: 'input' | 'include';

	/**
	 * Raw argument content, without braces.
	 *
	 * foo/bar.tex
	 */
	path: string;

	/**
	 * Argument content range only:
	 *
	 * \input{foo/bar.tex}
	 */
	pathStart: number;
	pathEnd: number;
}

const INPUT_MACROS = new Set([
	'input',
	'include',
]);

export function findLatexInputReferences(
	source: string,
): LatexInputReference[] {
	const results: LatexInputReference[] = [];

	let i = 0;

	while (i < source.length) {
		const char = source[i];

		// Comment: ignore everything until newline.
		if (char === '%' && !isEscaped(source, i)) {
			i = skipComment(source, i);
			continue;
		}

		if (char !== '\\') {
			i++;
			continue;
		}

		// Escaped backslash or control symbol, not a control word we care about.
		const macro = readControlSequence(source, i);

		if (!macro) {
			i++;
			continue;
		}

		i = macro.end;

		if (!INPUT_MACROS.has(macro.name)) {
			continue;
		}

		const parsed = readRequiredArgument(source, macro.end);

		if (!parsed) {
			throw new Error(
				`\\${macro.name} at offset ${macro.start} has no valid required argument`,
			);
		}

		results.push({
			type: macro.name as LatexInputReference['type'],
			path: parsed.content,
			pathStart: parsed.contentStart,
			pathEnd: parsed.contentEnd,
		});

		i = parsed.end;
	}

	return results;
}

interface ControlSequence {
	name: string;
	start: number;
	end: number;
}

function readControlSequence(
	source: string,
	start: number,
): ControlSequence | undefined {
	if (source[start] !== '\\') {
		return undefined;
	}

	const next = source[start + 1];

	if (!next) {
		return undefined;
	}

	// LaTeX control word:
	// \input
	// \include
	if (isAsciiLetter(next)) {
		let i = start + 1;

		while (i < source.length && isAsciiLetter(source[i])) {
			i++;
		}

		return {
			name: source.slice(start + 1, i),
			start,
			end: i,
		};
	}

	// Control symbol like:
	// \%
	// \{
	// \\
	//
	// Not something we care about.
	return {
		name: next,
		start,
		end: start + 2,
	};
}

interface RequiredArgument {
	content: string;
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
}

function readRequiredArgument(
	source: string,
	start: number,
): RequiredArgument | undefined {
	let i = skipWhitespaceAndComments(source, start);

	if (source[i] !== '{') {
		return undefined;
	}

	const argumentStart = i;
	const contentStart = i + 1;

	i++;

	let depth = 1;

	while (i < source.length) {
		const char = source[i];

		if (char === '%' && !isEscaped(source, i)) {
			i = skipComment(source, i);
			continue;
		}

		if (char === '\\') {
			// Skip escaped character/control symbol so something like
			// \{ doesn't affect brace depth.
			const control = readControlSequence(source, i);

			if (control) {
				i = control.end;
				continue;
			}
		}

		if (char === '{') {
			depth++;
			i++;
			continue;
		}

		if (char === '}') {
			depth--;

			if (depth === 0) {
				return {
					content: source.slice(contentStart, i),
					start: argumentStart,
					end: i + 1,
					contentStart,
					contentEnd: i,
				};
			}

			i++;
			continue;
		}

		i++;
	}

	throw new Error(
		`Unterminated LaTeX argument starting at offset ${argumentStart}`,
	);
}

function skipWhitespaceAndComments(
	source: string,
	start: number,
): number {
	let i = start;

	while (i < source.length) {
		if (isWhitespace(source[i])) {
			i++;
			continue;
		}

		if (source[i] === '%' && !isEscaped(source, i)) {
			i = skipComment(source, i);
			continue;
		}

		break;
	}

	return i;
}

function skipComment(
	source: string,
	start: number,
): number {
	let i = start;

	while (
		i < source.length &&
		source[i] !== '\n' &&
		source[i] !== '\r'
	) {
		i++;
	}

	return i;
}

function isEscaped(
	source: string,
	index: number,
): boolean {
	let backslashes = 0;

	for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) {
		backslashes++;
	}

	return backslashes % 2 === 1;
}

function isAsciiLetter(char: string): boolean {
	return (
		(char >= 'a' && char <= 'z') ||
		(char >= 'A' && char <= 'Z')
	);
}

function isWhitespace(char: string): boolean {
	return (
		char === ' ' ||
		char === '\t' ||
		char === '\n' ||
		char === '\r'
	);
}