import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadModule } from '../support/load-module.mjs';
import { MarkdownView } from '../support/obsidian.mjs';
import { createVault } from '../support/vault.mjs';

const { resolvePathRelToVault, resolveDependencyContent } = await loadModule(
	'src/latexRender/resolvers/paths.ts',
);
const { LatexRenderCompilationSession } = await loadModule(
	'src/latexRender/latexRenderCompilationSession.ts',
);
const sharedNote = await readFile(new URL('../fixtures/shared.md', import.meta.url), 'utf8');

function fixture() {
	return createVault({
		'notes/chapter/note.md': '```latex-file name: local\nLocal content\n```',
		'notes/chapter/figure.tex': 'Figure',
		'notes/shared/macros.tex': '\\newcommand{\\answer}{42}',
		'notes/shared.md': sharedNote,
		'attachments/image.png': new Uint8Array([137, 80, 78, 71]),
	});
}

test('resolves dependencies relative to the requesting note', () => {
	const { app } = fixture();
	for (const [requested, expected] of [
		['figure.tex', 'notes/chapter/figure.tex'],
		['./figure.tex', 'notes/chapter/figure.tex'],
		['../shared/macros.tex', 'notes/shared/macros.tex'],
		['..\\shared\\macros.tex', 'notes/shared/macros.tex'],
		['::local', 'notes/chapter/note.md::local.tex'],
		['../shared.md::macros', 'notes/shared.md::macros.tex'],
		['../shared::macros', 'notes/shared.md::macros.tex'],
	]) {
		assert.equal(resolvePathRelToVault(requested, 'notes/chapter/note.md', app), expected);
	}
	assert.equal(resolvePathRelToVault('attachments/image.png', '', app), 'attachments/image.png');
});

test('reports missing dependencies and paths outside the vault', () => {
	const { app } = fixture();
	assert.throws(() => resolvePathRelToVault('missing.tex', 'notes/chapter/note.md', app), {
		userTitle: 'Dependency file not found',
	});
	assert.throws(
		() => resolvePathRelToVault('../../../outside.tex', 'notes/chapter/note.md', app),
		{ userTitle: 'Invalid dependency path' },
	);
	assert.throws(() => resolvePathRelToVault('::invalid/name', 'notes/chapter/note.md', app), {
		userTitle: 'Invalid code block name',
	});
});

test('reads text and binary dependencies without changing their contents', async () => {
	const { app } = fixture();
	assert.deepEqual(await resolveDependencyContent('notes/shared/macros.tex', app), {
		content: '\\newcommand{\\answer}{42}',
		compilePipeline: 'plain',
	});
	assert.deepEqual(
		(await resolveDependencyContent('attachments/image.png', app)).content,
		new Uint8Array([137, 80, 78, 71]),
	);
});

test('extracts named blocks with their own preprocessing pipeline', async () => {
	const { app } = fixture();
	assert.deepEqual(await resolveDependencyContent('notes/shared.md::macros.tex', app), {
		content: '\\newcommand{\\answer}{42}',
		compilePipeline: 'plain',
	});
	assert.deepEqual(await resolveDependencyContent('notes/shared.md::diagram.tex', app), {
		content: '\\draw (0,0) -- (1,1);',
		compilePipeline: 'process',
	});
});

test('uses unsaved editor content when resolving a named block', async () => {
	const vault = fixture();
	vault.leaves.push({
		view: Object.assign(new MarkdownView(), {
			file: vault.app.vault.getAbstractFileByPath('notes/shared.md'),
			editor: { getValue: () => '```latex-file name: macros\nUnsaved macros\n```' },
		}),
	});
	assert.equal(
		(await resolveDependencyContent('notes/shared.md::macros.tex', vault.app)).content,
		'Unsaved macros',
	);
});

test('reports missing and duplicate code block names', async () => {
	const vault = fixture();
	await assert.rejects(resolveDependencyContent('notes/shared.md::missing.tex', vault.app), {
		userTitle: 'LaTeX code block not found',
	});
	vault.write('notes/shared.md', sharedNote + '\n```latex-file name: macros\nDuplicate\n```');
	await assert.rejects(resolveDependencyContent('notes/shared.md::macros.tex', vault.app), {
		userTitle: 'Duplicate LaTeX code block name',
	});
	await assert.rejects(resolveDependencyContent('notes/shared.md::macros::extra', vault.app), {
		userTitle: 'Invalid dependency path',
	});
});

test('maps nested worker requests back to their source files', async (t) => {
	const vault = fixture();
	vault.write('notes/shared/outer.tex', '\\input{macros}');
	const session = new LatexRenderCompilationSession(
		{ plugin: { app: vault.app } },
		'notes/chapter/note.md',
	);
	const worker = { postMessage: t.mock.fn() };
	const resolve = (requestedPath, requestingPath, requestId) =>
		session.handleWorkerMessage(
			{
				cmd: 'resolvefile',
				requestedPath,
				requestingPath,
				requestId,
				format: 26,
			},
			worker,
		);

	assert.equal(await resolve('../shared/outer', '/work/main.tex', 1), true);
	const outer = worker.postMessage.mock.calls.at(-1).arguments[0];
	assert.equal(outer.found, true);
	await resolve('macros', `/work/${outer.virtualPath}`, 2);
	const inner = worker.postMessage.mock.calls.at(-1).arguments[0];
	assert.equal(inner.found, true);
	assert.equal(new TextDecoder().decode(inner.content), '\\newcommand{\\answer}{42}');
	assert.equal(
		session.getVirtualPathMappings().get(inner.virtualPath),
		'notes/shared/macros.tex',
	);
	assert.deepEqual(Object.keys(session.createContentHashRecord()).sort(), [
		'notes/shared/macros.tex',
		'notes/shared/outer.tex',
	]);
	assert.equal(session.getResolvedFiles().length, 2);
});

test('resolves vault-root requests and preserves binary file data', async (t) => {
	const vault = fixture();
	const session = new LatexRenderCompilationSession(
		{ plugin: { app: vault.app } },
		'notes/chapter/note.md',
	);
	const worker = { postMessage: t.mock.fn() };
	await session.handleWorkerMessage(
		{
			cmd: 'resolvefile',
			requestedPath: '/attachments/image.png',
			requestingPath: 'main.tex',
			requestId: 3,
			format: 26,
		},
		worker,
	);
	const [message, transfers] = worker.postMessage.mock.calls[0].arguments;
	assert.equal(message.requestId, 3);
	assert.equal(message.found, true);
	assert.deepEqual(message.content, new Uint8Array([137, 80, 78, 71]));
	assert.deepEqual(transfers, [message.content.buffer]);
});

test('lets the worker fall back to TeX Live when a vault dependency is absent', async (t) => {
	const { app } = fixture();
	const session = new LatexRenderCompilationSession({ plugin: { app } }, 'notes/chapter/note.md');
	const worker = { postMessage: t.mock.fn() };
	assert.equal(await session.handleWorkerMessage({ cmd: 'unrelated' }, worker), false);
	await session.handleWorkerMessage(
		{
			cmd: 'resolvefile',
			requestedPath: 'article.cls',
			requestingPath: 'main.tex',
			requestId: 4,
			format: 26,
		},
		worker,
	);
	assert.deepEqual(worker.postMessage.mock.calls[0].arguments, [
		{ cmd: 'resolvefile', requestId: 4, found: false },
	]);
	assert.deepEqual(session.userFacingErrors, []);
});
