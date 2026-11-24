import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from '../support/load-module.mjs';
import { createVault } from '../support/vault.mjs';

const { getLatexTaskSectionInfosFromFile } = await loadModule(
	'src/latexRender/resolvers/taskSectionInformation.ts',
);
const { extractCodeBlockMetadata, codeBlockToContent } = await loadModule(
	'src/latexRender/resolvers/latexSourceFromFile.ts',
);
const { getLatexCodeBlockDefinition } = await loadModule('src/latexRender/codeBlockTypes.ts');

test('recognizes all supported block types without accepting language prefixes', async () => {
	const source = [
		'```latex-file name: macros\nMacros\n```',
		'```latexsvg\nVector\n```',
		'```LaTeX\nDocument\n```',
		'~~~tikz\nPicture\n~~~',
		'```latex-other\nIgnored\n```',
	].join('\n\n');
	const { app } = createVault({ 'note.md': source });
	const sections = await getLatexTaskSectionInfosFromFile(
		app.vault.getAbstractFileByPath('note.md'),
		app,
	);
	assert.deepEqual(
		sections.map((section) => section.language),
		['latex-file', 'latexsvg', 'LaTeX', 'tikz'],
	);
	assert.deepEqual(
		sections.map((section) => codeBlockToContent(section.codeBlock)),
		['Macros', 'Vector', 'Document', 'Picture'],
	);
	assert.equal(sections[0].lineStart, 0);
	assert.equal(sections[0].lineEnd, 2);
});

test('extracts names and content from code blocks inside a longer Markdown fence', async () => {
	const source =
		'````markdown\n```latex-file name: shared_macros\n\\newcommand{\\answer}{42}\n```\n````';
	const { app } = createVault({ 'note.md': source });
	const sections = await getLatexTaskSectionInfosFromFile(
		app.vault.getAbstractFileByPath('note.md'),
		app,
	);
	assert.equal(sections.length, 1);
	assert.deepEqual(extractCodeBlockMetadata(sections[0].codeBlock), {
		language: 'latex-file',
		name: 'shared_macros',
	});
	assert.equal(codeBlockToContent(sections[0].codeBlock), '\\newcommand{\\answer}{42}');
});

test('selects the output format and preprocessing pipeline for each block type', () => {
	assert.deepEqual(getLatexCodeBlockDefinition('latex'), {
		compilePipeline: 'plain',
		resultFormat: 'pdf',
		render: true,
	});
	assert.deepEqual(getLatexCodeBlockDefinition('latexsvg'), {
		compilePipeline: 'plain',
		resultFormat: 'svg',
		render: true,
	});
	assert.deepEqual(getLatexCodeBlockDefinition('TIKZ'), {
		compilePipeline: 'process',
		resultFormat: 'svg',
		render: true,
	});
	assert.deepEqual(getLatexCodeBlockDefinition('latex-file'), {
		compilePipeline: 'plain',
		render: false,
	});
	assert.throws(
		() => getLatexCodeBlockDefinition('unsupported'),
		/Unsupported LaTeX code block language/,
	);
});
