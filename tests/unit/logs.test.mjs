import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadModule } from '../support/load-module.mjs';

const { default: parseLatexLog, refactorLogToErrorMessage } = await loadModule(
	'src/latexRender/logs/humanReadableLogs.ts',
);
const log = await readFile(new URL('../fixtures/compilation.txt', import.meta.url), 'utf8');

for (const lineEnding of ['\n', '\r\n']) {
	test(`parses compiler errors and warnings with ${lineEnding === '\n' ? 'LF' : 'CRLF'} line endings`, () => {
		const result = parseLatexLog(log.replaceAll('\n', lineEnding));
		assert.equal(result.errors.length, 1);
		assert.equal(result.errors[0].message, 'Undefined control sequence.');
		assert.equal(result.errors[0].line, 7);
		assert.equal(result.errors[0].file, './__deps/0.tex');
		assert.equal(result.errors[0].cause, '\\unknowncommand');
		assert.deepEqual(
			result.warnings.map((entry) => [entry.file, entry.line]),
			[
				['./main.tex', 12],
				['./main.tex', 14],
			],
		);
		assert.match(result.warnings[1].message, /removing `math shift'/);
		assert.equal(result.typesetting[0].line, 15);
		assert.deepEqual(result.files, [
			{ path: './main.tex', files: [{ path: './__deps/0.tex', files: [] }] },
		]);
	});
}

test('parses file-and-line compiler errors', () => {
	const result = parseLatexLog(
		'Engine header\n./main.tex:23: Missing $ inserted.\nl.23 x_1\n\n\n',
	);
	assert.equal(result.errors[0].file, './main.tex');
	assert.equal(result.errors[0].line, 23);
	assert.deepEqual(refactorLogToErrorMessage(result), {
		title: 'Missing $ inserted.',
		cause: 'x_1',
		line: 23,
	});
});

test('deduplicates repeated warnings when requested', () => {
	const warning = 'LaTeX Warning: Label `eq' + "' multiply defined.\n";
	assert.equal(parseLatexLog(`Engine header\n${warning}${warning}`).warnings.length, 1);
	assert.equal(parseLatexLog(`Engine header\n${warning}${warning}`, false).warnings.length, 2);
});

test('keeps the raw log available when no specific error can be extracted', () => {
	const raw = 'Engine stopped without a diagnostic';
	assert.deepEqual(refactorLogToErrorMessage(parseLatexLog(raw)), {
		title: 'Unknown LaTeX error',
		explanation: raw,
	});
});
