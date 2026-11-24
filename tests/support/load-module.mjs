import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputDirectory = await mkdtemp(join(tmpdir(), 'latex-compiler-tests-'));
const modules = new Map();

after(() => rm(outputDirectory, { recursive: true, force: true }));

export function loadModule(path) {
	if (!modules.has(path)) modules.set(path, bundleModule(path));
	return modules.get(path);
}

async function bundleModule(path) {
	const name = createHash('sha256').update(path).digest('hex').slice(0, 12);
	const outfile = join(outputDirectory, `${name}.mjs`);

	await build({
		absWorkingDir: projectRoot,
		entryPoints: [path],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		sourcemap: 'inline',
		plugins: [
			{
				name: 'obsidian-test-api',
				setup(build) {
					build.onResolve({ filter: /^obsidian$/ }, () => ({
						path: new URL('./obsidian.mjs', import.meta.url).href,
						external: true,
					}));
				},
			},
		],
	});

	return import(pathToFileURL(outfile).href);
}
