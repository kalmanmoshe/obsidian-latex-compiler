import { Command, Notice } from 'obsidian';
import LatexCompilerPlugin from 'src/main';
import { getTestCommands } from 'src/tests/compileTest';
import { extractAllSectionsByFile } from 'src/latexRender/resolvers/latexSourceFromFile';
import { hashLatexContent } from 'src/latexRender/cache/compilerCache';
import { LatexTask } from 'src/latexRender/task/latexTask';
import { codeBlockToContent } from 'obsidian-dev-utils';
import { createBenchmarkCurrentFileCommand } from 'src/tests/benchmarkCurrentFileTest';

function removeAllCachedPackages(plugin: LatexCompilerPlugin): Command {
	return {
		id: 'remove-all-cached-packages',
		name: 'Remove all cached packages',
		callback() {
			void plugin.latexRenderer.cache.removeAllCachedPackages();
			new Notice('All cached packages removed');
		},
	};
}

async function extractAllUnrenderedSectionsByFile(plugin: LatexCompilerPlugin) {
	const sectionsByFile = await extractAllSectionsByFile(plugin.app);
	const sectionInfosByFile = [];

	for (const { file, codeBlockSections } of sectionsByFile) {
		const fileInfos = [];

		for (const section of codeBlockSections) {
			const codeBlock = codeBlockToContent(section.codeBlock);
			const hash = hashLatexContent(codeBlock);
			if (!plugin.latexRenderer.cache.resultFileCache.hasRawHash(hash)) {
				fileInfos.push(section);
			}
		}

		if (fileInfos.length > 0) {
			sectionInfosByFile.push({ file, codeBlockSections: fileInfos });
		}
	}
	return sectionInfosByFile;
}

async function renderAllUnrenderedCodeBlocks(plugin: LatexCompilerPlugin) {
	if (!plugin.latexRenderer.isCompilerEnabled()) {
		throw new Error('Render all unrendered code blocks is not supported on this device because the compiler is disabled');
	}
	const sectionInfosByFile = await extractAllUnrenderedSectionsByFile(plugin);
	let count = 0;
	for (const { file, codeBlockSections } of sectionInfosByFile) {
		for (const codeBlock of codeBlockSections) {
			const task = LatexTask.fromSectionInfos(plugin, file.path, [codeBlock]);
			plugin.latexRenderer.queue.push(task);
			count++;
		}
	}
	new Notice(`${count} code blocks in ${sectionInfosByFile.length} files are being processed`);
}

function getRenderAllUnrenderedCodeBlocks(plugin: LatexCompilerPlugin) {
	if (!plugin.latexRenderer.isCompilerEnabled()) return undefined;

	return {
		id: 'render-all-unrendered-code-blocks',
		name: 'Render All Unrendered Code Blocks',
		callback: async () => {
			await renderAllUnrenderedCodeBlocks(plugin);
			new Notice('All unrendered code blocks are being processed');
		},
	};
}

function getRebuildQueue(plugin: LatexCompilerPlugin) {
	if (!plugin.latexRenderer.isCompilerEnabled()) return undefined;

	return {
		id: 'rebuild-queue',
		name: 'Rebuild Render Queue',
		callback: async () => {
			plugin.latexRenderer.queue!.rebuild();
			new Notice('Render queue rebuilt');
		},
	};
}

function getAbortTasks(plugin: LatexCompilerPlugin) {
	if (!plugin.latexRenderer.isCompilerEnabled()) return undefined;

	return {
		id: 'abort-latex-tasks',
		name: 'Abort All LaTeX Tasks',
		callback: () => {
			plugin.latexRenderer.queue!.abortAllWaiting();
			new Notice('All tasks aborted');
		},
	};
}

function getClearTemporaryCache(plugin: LatexCompilerPlugin) {
	if (!plugin.latexRenderer.isCompilerEnabled()) return undefined;

	return {
		id: 'clear-temporary-cache',
		name: 'Clear Temporary Cache',
		callback: async () => {
			await plugin.latexRenderer.compiler?.flushCache();
			new Notice('Temporary cache cleared');
		},
	};
}

function getRestartCompilerCommand(plugin: LatexCompilerPlugin) {
	return {
		id: 'restart-compiler',
		name: 'Restart LaTeX Compiler',
		callback: async () => {
			await plugin.latexRenderer.restartCompiler();
			new Notice('LaTeX compiler restarted');
		},
	};
}

export const getEditorCommands = (plugin: LatexCompilerPlugin): (Command | undefined)[] => {
	let testCommands: (Command | undefined)[];
	if (__PRODUCTION__) {
		testCommands = [];
	} else {
		testCommands = [
			...getTestCommands(plugin),
			createBenchmarkCurrentFileCommand(plugin),
			getRenderAllUnrenderedCodeBlocks(plugin),

		];
	}
	return [
		...testCommands,
		removeAllCachedPackages(plugin),
		getRebuildQueue(plugin),
		getAbortTasks(plugin),
		getClearTemporaryCache(plugin),
		getRestartCompilerCommand(plugin),
	];
};
