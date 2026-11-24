import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from '../support/load-module.mjs';
import { deferred } from '../support/fakes.mjs';
import { createVault } from '../support/vault.mjs';

const { default: ResultFileCache } = await loadModule('src/latexRender/cache/resultFileCache.ts');
const { hashContent, hashLatexContent } = await loadModule(
	'src/latexRender/cache/compilerCache.ts',
);
const source = '\\input{shared.tex}';
const rawHash = hashLatexContent(source);

async function createCache(physicalCache = false) {
	const vault = createVault({
		'note.md': `\`\`\`latex\n${source}\n\`\`\``,
		'other.md': `\`\`\`latex\n${source}\n\`\`\``,
		'shared.tex': 'Original dependency',
		'shared.md': '```latex-file name: macros\nOriginal macros\n```',
	});
	const plugin = {
		app: vault.app,
		settings: { physicalCache, resultCacheIndex: {}, physicalCacheLocation: '' },
		getCacheDir: () => 'test-cache',
	};
	const cache = await openCache(plugin);
	const dependencies = { 'shared.tex': hashContent('Original dependency') };
	const add = (data = new Uint8Array([37, 80, 68, 70])) =>
		cache.addFile(data, rawHash, 'note.md', dependencies, 'plain', 'pdf');
	const get = () => cache.getResultFile(rawHash, 'note.md', 'plain', 'pdf');
	return { cache, plugin, vault, dependencies, add, get };
}

async function openCache(plugin) {
	const initialized = deferred();
	plugin.saveSettings = async () => {
		initialized.resolve();
	};
	const cache = new ResultFileCache(plugin);
	await initialized.promise;
	return cache;
}

for (const physical of [false, true]) {
	const storage = physical ? 'physical' : 'memory';

	test(`${storage} cache reuses results while dependencies are unchanged`, async () => {
		const { add, get } = await createCache(physical);
		const pdf = new Uint8Array([37, 80, 68, 70]);
		await add(pdf);
		assert.deepEqual((await get()).data, pdf);
		assert.deepEqual((await get()).data, pdf);
	});

	test(`${storage} cache invalidates edited and deleted dependencies`, async () => {
		const { add, get, vault } = await createCache(physical);
		await add();
		vault.write('shared.tex', 'Edited dependency');
		assert.equal(await get(), undefined);
		vault.write('shared.tex', 'Original dependency');
		assert.ok(await get());
		vault.remove('shared.tex');
		assert.equal(await get(), undefined);
	});

	test(`${storage} cache invalidates edited named blocks`, async () => {
		const { cache, vault } = await createCache(physical);
		await cache.addFile(
			'<svg/>',
			rawHash,
			'note.md',
			{ 'shared.md::macros.tex': hashContent('Original macros') },
			'plain',
			'svg',
		);
		assert.ok(await cache.getResultFile(rawHash, 'note.md', 'plain', 'svg'));
		vault.write('shared.md', '```latex-file name: macros\nEdited macros\n```');
		assert.equal(await cache.getResultFile(rawHash, 'note.md', 'plain', 'svg'), undefined);
	});

	test(`${storage} cache keeps notes, pipelines, and output formats independent`, async () => {
		const { cache, dependencies } = await createCache(physical);
		const variants = [
			['note.md', 'plain', 'svg', '<svg>plain</svg>'],
			['note.md', 'process', 'svg', '<svg>processed</svg>'],
			['other.md', 'plain', 'svg', '<svg>other</svg>'],
			['note.md', 'plain', 'pdf', new Uint8Array([37, 80, 68, 70])],
		];
		for (const [path, pipeline, format, data] of variants) {
			await cache.addFile(data, rawHash, path, dependencies, pipeline, format);
		}
		for (const [path, pipeline, format, data] of variants) {
			assert.deepEqual(
				(await cache.getResultFile(rawHash, path, pipeline, format)).data,
				data,
			);
		}
	});

	test(`${storage} cache replaces an existing variant without duplicating its index entry`, async () => {
		const { cache, plugin, vault, dependencies, add, get } = await createCache(physical);
		await add();
		vault.write('shared.tex', 'Updated dependency');
		const updatedDependencies = {
			...dependencies,
			'shared.tex': hashContent('Updated dependency'),
		};
		const replacement = new Uint8Array([1, 2, 3]);
		await cache.addFile(replacement, rawHash, 'note.md', updatedDependencies, 'plain', 'pdf');
		assert.equal(plugin.settings.resultCacheIndex[rawHash].length, 1);
		assert.deepEqual((await get()).data, replacement);
	});

	test(`${storage} cache rejects empty output including empty views of nonempty buffers`, async () => {
		const { add } = await createCache(physical);
		for (const content of ['', new Uint8Array(), new Uint8Array([1]).subarray(0, 0)]) {
			await assert.rejects(add(content), /Cannot add empty content/);
		}
	});

	test(`${storage} cache clears stored output and its index`, async () => {
		const { cache, plugin, add, get } = await createCache(physical);
		await add();
		await cache.removeAllCached();
		assert.equal(await get(), undefined);
		assert.equal(cache.hasRawHash(rawHash), false);
		assert.deepEqual(plugin.settings.resultCacheIndex, {});
	});

	test(`${storage} cache persists removal of a result`, async () => {
		const { cache, plugin, add, get } = await createCache(physical);
		await add();
		assert.equal(
			await cache.removeResultFileFromCache(rawHash, 'note.md', 'plain', 'pdf'),
			true,
		);
		assert.equal(await get(), undefined);
		assert.equal(cache.hasRawHash(rawHash), false);
		assert.deepEqual(plugin.settings.resultCacheIndex, {});
	});
}

test('physical cache survives a restart and recovers from a missing output file', async () => {
	const { plugin, vault, add } = await createCache(true);
	await add();
	const cache = await openCache(plugin);
	const result = await cache.getResultFile(rawHash, 'note.md', 'plain', 'pdf');
	assert.deepEqual(result.data, new Uint8Array([37, 80, 68, 70]));
	await vault.app.vault.adapter.remove(`test-cache/result-cache/${result.stem}.pdf`);
	assert.equal(await cache.getResultFile(rawHash, 'note.md', 'plain', 'pdf'), undefined);
	await cache.addFile(new Uint8Array([1]), rawHash, 'note.md', {}, 'plain', 'pdf');
	assert.deepEqual(
		(await cache.getResultFile(rawHash, 'note.md', 'plain', 'pdf')).data,
		new Uint8Array([1]),
	);
});

test('physical cache writes only the bytes selected by a typed array view', async () => {
	const { add, get } = await createCache(true);
	await add(new Uint8Array([0, 37, 80, 68, 70, 0]).subarray(1, 5));
	assert.deepEqual((await get()).data, new Uint8Array([37, 80, 68, 70]));
});
