import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from '../support/load-module.mjs';
import { TFile, TFolder } from '../support/obsidian.mjs';

const { LatexSourceProcessor } = await loadModule('src/latexPreprocessor/latexSourceProcessor.ts');
const { CompilePipeline } = await loadModule('src/settings/settings.ts');
const { parse } = await loadModule('src/latexPreprocessor/ast/latexParser.ts');

async function preprocess(source, autoUseFiles = [], pipeline = CompilePipeline.Process) {
	const processor = new LatexSourceProcessor({ getAutoUseFilePaths: () => autoUseFiles }, {});
	const { content } = await processor.parseFile(source, 'note.md', pipeline);
	return content;
}

test('keeps the custom preamble and places auto-use inputs after the document class', async () => {
	const documentclass = '\\documentclass [border={2mm}]{standalone}';
	const preamble = [
		'\\usepackage% keep this comment',
		'  [table]{xcolor}',
		'\\usetikzlibrary{arrows.meta}',
		'\\pgfplotsset{compat=1.18}',
	].join('\n');
	const source = '\n% note\n' + documentclass + '\n' + preamble + '\n\\draw (0,0) -- (1,1);';
	const result = await preprocess(source, ['shared.tex']);
	assert.ok(
		result.startsWith('\n% note\n' + documentclass + '\\input{/shared.tex}\n' + preamble),
	);
	assert.ok(result.includes('\\begin{document}\n\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);'));
});

test('applies fragment options to the missing wrapper around an axis', async () => {
	const axis = '\\begin{axis}[title={a [label]}]\\addplot {x^2};\\end{axis}';
	const result = await preprocess('[scale=2]\n' + axis);
	assert.match(result, /^\\documentclass\[tikz,border=2mm\]\{standalone\}/);
	assert.ok(result.includes('\\begin{document}\n\\begin{tikzpicture}[scale=2]\n' + axis));
	assert.match(result, /\\end\{tikzpicture\}\n\\end\{document\}\n$/);
});

test('preserves an existing document, math, macro definitions, and verbatim text', async () => {
	const source = [
		'\\documentclass{article}',
		'\\newcommand{\\startpicture}{\\begin{tikzpicture}}',
		'\\begin{document}',
		'\\[\\begin{align*}x &= y\\end{align*}\\]',
		'\\verb*|\\end{document}|',
		'\\begin{verbatim}',
		'  \\input{literal} } % \\begin{axis}',
		'',
		'  Second line.',
		'\\end{verbatim}',
		'\\end{document}',
		'',
	].join('\r\n');
	assert.equal(await preprocess(source), source);
});

test('keeps inline listings and a final comment inside the generated wrappers', async () => {
	const source = [
		'\\node {\\lstinline[language=TeX]|\\input{literal} \\begin{axis}|};',
		'\\node {\\mintinline{tex}|\\include{literal} \\end{tikzpicture}|};',
		'\\draw (0,0) -- (1,1); % finish',
	].join('\n');
	const result = await preprocess(source);
	assert.ok(result.includes('\\begin{tikzpicture}\n' + source + '\n\\end{tikzpicture}'));
});

test('an unmatched math delimiter does not hide existing TikZ and document wrappers', async () => {
	for (const delimiter of ['$$', '$', '\\[', '\\(']) {
		const source = [
			'\\usepackage{tikz}\\usetikzlibrary{calc,}',
			'\\begin{document}\\begin{tikzpicture}',
			'[x=1cm,y=1cm]',
			'\\coordinate (a) at (0,0);',
			'\\fill ($(a)+(1,1)$) circle (2pt);',
			'\\fill (2*(1,.5)$) circle (2pt);',
			delimiter,
			'\\end{tikzpicture}\\end{document}',
		].join('\n');
		assert.equal(
			await preprocess(source, ['preamble.tex']),
			'\\documentclass[tikz,border=2mm]{standalone}\\input{/preamble.tex}' + source,
		);
	}
});

test('passes plain LaTeX through without preprocessing', async () => {
	const source = '\\input{unresolved}\r\n\r\n% comment';
	assert.equal(await preprocess(source, ['shared.tex'], CompilePipeline.Plain), source);
});

test('removes blank lines from TikZ paths and arguments, including after comments', async () => {
	const source = [
		'\\begin{tikzpicture}',
		'\\draw (0,0) % continue the path below',
		' \t',
		'  -- (1,1);',
		'\\node {first',
		'',
		'second};',
		'\\end{tikzpicture}',
	];
	for (const lineEnding of ['\n', '\r\n']) {
		const result = await preprocess(source.join(lineEnding));
		assert.ok(result.includes(source.filter((line) => line.trim()).join(lineEnding)));
	}
});

test('reports the original path spans for real inputs after escaped characters and comments', () => {
	const source =
		'\\% \\\\input{escaped} % \\include{comment}\r\n\\node {\\include % gap\r\n {a/{b}.tex}};';
	const {
		inputReferences: [ref, ...rest],
	} = parse(source);
	assert.equal(rest.length, 0);
	assert.equal(ref.type, 'include');
	assert.equal(ref.path, 'a/{b}.tex');
	assert.equal(source.slice(ref.pathStart, ref.pathEnd), ref.path);
});

test('a nested explicit input suppresses the matching automatic preamble input', async () => {
	const parent = Object.assign(new TFolder(), { path: 'figures', children: [] });
	const note = Object.assign(new TFile(), { path: 'figures/note.md', parent });
	const labels = Object.assign(new TFile(), {
		path: 'figures/labels.tex',
		name: 'labels.tex',
		parent,
	});
	parent.children.push(note, labels);
	const vfs = { getAutoUseFilePaths: () => [labels.path, 'preamble.tex'] };
	const app = { vault: { getAbstractFileByPath: (path) => (path === note.path ? note : null) } };
	const processor = new LatexSourceProcessor(vfs, app);
	const source = '\\node {\\input{./labels.tex}};';
	const { content } = await processor.parseFile(source, note.path, CompilePipeline.Process);
	assert.ok(content.includes(source));
	assert.ok(content.includes('\\input{/preamble.tex}'));
	assert.ok(!content.includes('\\input{/figures/labels.tex}'));
});

test('preprocessing an already processed fragment does not add more wrappers', async () => {
	const once = await preprocess('\\draw (0,0) -- (1,1);');
	assert.equal(await preprocess(once), once);
});

test('ignores dependency commands inside comments and verbatim text', () => {
	const source = [
		'% \\input{commented}',
		'\\verb|\\input{inline}|',
		'\\begin{verbatim}\\include{literal}\\end{verbatim}',
		'\\input{real}',
	].join('\n');
	assert.deepEqual(
		parse(source).inputReferences.map((reference) => reference.path),
		['real'],
	);
});
