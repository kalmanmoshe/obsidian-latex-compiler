import {
	LatexAbstractSyntaxTree,
} from 'src/latexPreprocessor/ast/latexAbstractSyntaxTree';
import {
	resolvePathRelToVault,
	CODE_BLOCK_NAME_SEPARATOR,
} from '../latexRender/resolvers/paths';
import { LatexDependency } from 'src/latexRender/latexDependency';
import { App } from 'obsidian';
import { VirtualFileSystem } from './virtualFileSystem';
import { CompilePipeline } from 'src/settings/settings';

export interface LatexDependencyNode {
	dependency: LatexDependency;
	dependencies: LatexDependencyNode[];
}

export interface ParsedLatexFile {
	content: string;
	path: string;
	dependencies: LatexDependencyNode[];
}

export class LatexSourceProcessor {
	constructor(
		private vfs: VirtualFileSystem,
		private app: App
	) { }

	async parseFile(
		content: string,
		sourcePath: string,
		compilePipeline: CompilePipeline
	) {

		if (compilePipeline !== CompilePipeline.Process) {
			return {
				content,
				path: sourcePath,
			};
		}

		return this.processTikzCodeBlock(
			content,
			sourcePath,
		);
	}

	private processTikzCodeBlock(
		content: string,
		sourcePath: string,
	) {

		const { ast, inputReferences } = LatexAbstractSyntaxTree.parse(content);
		const basePath = getBasePath(sourcePath);

		// If a dependency path cannot be resolved in the vault,
		// keep the original path and continue safely.
		const surfaceDependencyPaths = new Set(
			inputReferences.map(({ path }) => {
				try {
					return resolvePathRelToVault(path, basePath, this.app);
				} catch {
					return path;
				}
			})
		);

		const autoUseFiles = this.vfs
			.getAutoUseFilePaths()
			.filter(
				(path) => !surfaceDependencyPaths.has(path)
			);

		// Ideally this method only emits \input references.
		// It should not require the actual dependency content.
		ast.addAutoUseDependenciesToPreamble(autoUseFiles);


		// Fragment -> complete compilable document.
		ast.verifyProperDocumentStructure();

		return {
			content: ast.toString(),
			path: sourcePath,
		};
	}
}

function getBasePath(sourcePath: string): string {
	if (sourcePath.includes(CODE_BLOCK_NAME_SEPARATOR)) {
		sourcePath = sourcePath.split(CODE_BLOCK_NAME_SEPARATOR)[0];
	}
	return sourcePath;
}
