import {
	LatexAbstractSyntaxTree,
} from 'src/latexPreprocessor/ast/latexAbstractSyntaxTree';
import {
	resolvePathRelToVault,
	CODE_BLOCK_NAME_SEPARATOR,
} from '../latexRender/resolvers/paths';
import { LatexDependency, LatexSourceType } from 'src/latexRender/latexDependency';
import { App } from 'obsidian';
import { findLatexInputReferences } from './latexInputScanner';
import { VirtualFileSystem } from './virtualFileSystem';

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
		sourceType: LatexSourceType
	) {

		if (sourceType !== LatexSourceType.TikzCodeBlock) {
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

	private async processTikzCodeBlock(
		content: string,
		sourcePath: string,
	) {

		const surfaceDependencyPaths = await this.collectSurfaceDependencyPaths(
			content,
			sourcePath,
		);

		const ast = LatexAbstractSyntaxTree.parse(content);

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
	private async collectSurfaceDependencyPaths(
		content: string,
		sourcePath: string,
	): Promise<Set<string>> {

		const basePath = getBasePath(sourcePath);
		const paths = new Set<string>();

		for (const ref of findLatexInputReferences(content)) {
			const resolvedPath = resolvePathRelToVault(
				ref.path,
				basePath,
				this.app,
			);

			paths.add(resolvedPath);
		}

		return paths;
	}

}

function getBasePath(sourcePath: string): string {
	if (sourcePath.includes(CODE_BLOCK_NAME_SEPARATOR)) {
		sourcePath = sourcePath.split(CODE_BLOCK_NAME_SEPARATOR)[0];
	}
	return sourcePath;
}
