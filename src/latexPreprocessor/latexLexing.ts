interface ControlSequence {
	name: string;
	end: number;
}

const controlWord = /[a-zA-Z]+/y;

// The caller consumes the entire control sequence, including escaped punctuation.
export function readControlSequence(source: string, start: number): ControlSequence | undefined {
	const next = source[start + 1];
	if (source[start] !== '\\' || next === undefined) return;

	controlWord.lastIndex = start + 1;
	const word = controlWord.exec(source)?.[0];
	const name = word ?? next;
	return { name, end: start + 1 + name.length };
}

export function isWhitespace(char: string | undefined): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

export function skipComment(source: string, start: number): number {
	while (start < source.length && source[start] !== '\n' && source[start] !== '\r') start++;
	return start;
}

export function skipWhitespaceAndComments(source: string, start: number): number {
	while (start < source.length) {
		if (isWhitespace(source[start])) {
			start++;
		} else if (source[start] === '%') {
			start = skipComment(source, start);
		} else {
			break;
		}
	}
	return start;
}

// Braces inside an optional argument protect any brackets they contain.
export function readArgumentEnd(source: string, start: number): number | undefined {
	const optional = source[start] === '[';
	let braces = optional ? 0 : 1;
	let brackets = optional ? 1 : 0;
	for (let i = start + 1; i < source.length; ) {
		const char = source[i];
		if (char === '%') {
			i = skipComment(source, i);
			continue;
		}
		const control = char === '\\' ? readControlSequence(source, i) : undefined;
		if (control) {
			i = control.end;
			continue;
		}

		i++;
		if (char === '{') braces++;
		if (char === '}' && braces > 0 && --braces === 0 && !optional) return i;
		if (optional && braces === 0) {
			if (char === '[') brackets++;
			if (char === ']' && --brackets === 0) return i;
		}
	}
}

const environmentName = /\{([^{}\s\\%]+)\}/y;

export function readEnvironmentName(source: string, start: number) {
	environmentName.lastIndex = skipWhitespaceAndComments(source, start);
	const match = environmentName.exec(source);
	if (match) return { name: match[1], end: environmentName.lastIndex };
}

const literalEnvironments = new Set([
	'verbatim',
	'verbatim*',
	'Verbatim',
	'BVerbatim',
	'LVerbatim',
	'lstlisting',
	'minted',
	'comment',
	'filecontents',
	'filecontents*',
]);

export function readLiteralEnd(source: string, control: ControlSequence): number | undefined {
	if (control.name === 'begin') {
		const env = readEnvironmentName(source, control.end);
		if (env && literalEnvironments.has(env.name)) {
			const close = '\\end{' + env.name + '}';
			const end = source.indexOf(close, env.end);
			if (end !== -1) return end + close.length;
		}
		return;
	}

	let start = source[control.end] === '*' ? control.end + 1 : control.end;
	if (control.name === 'lstinline' || control.name === 'mintinline' || control.name === 'mint') {
		start = skipWhitespaceAndComments(source, start);
		if (source[start] === '[') {
			const optionsEnd = readArgumentEnd(source, start);
			if (optionsEnd === undefined) return;
			start = skipWhitespaceAndComments(source, optionsEnd);
		}
		if (control.name !== 'lstinline') {
			if (source[start] !== '{') return;
			const languageEnd = readArgumentEnd(source, start);
			if (languageEnd === undefined) return;
			start = skipWhitespaceAndComments(source, languageEnd);
		}
		if (source[start] === '{') return readArgumentEnd(source, start);
	} else if (control.name !== 'verb' && control.name !== 'Verb') {
		return;
	}

	const delimiter = source[start];
	if (delimiter === undefined || isWhitespace(delimiter)) return;
	for (let i = start + 1; i < source.length; i++) {
		const char = source[i];
		if (char === '\n' || char === '\r') return;
		if (char === delimiter) return i + 1;
	}
}
