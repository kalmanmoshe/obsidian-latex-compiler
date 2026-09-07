import { App, normalizePath, TAbstractFile, TFile, TFolder } from 'obsidian';
import { getLatexTaskSectionInfosFromFile } from './taskSectionInformation';
import { extractCodeBlockMetadata, extractCodeBlockName } from './latexSourceFromFile';
import { codeBlockToContent } from 'obsidian-dev-utils';
import { LatexSourceType } from 'src/latexRender/latexDependency';
import { getLatexCodeBlockDefinition } from '../codeBlockTypes';
import { isTexSourceExtension } from 'src/latexPreprocessor/ast/latexAbstractSyntaxTree';
import { UserFacingPluginError } from '../errors/pluginErrors';
import { TEXT_EXTENSIONS } from './extensions';

export const CODE_BLOCK_NAME_SEPARATOR = '::';
const TRADITIONAL_PATH_SEPARATORS = ['/', '\\'];
const PATH_SEPARATORS = [...TRADITIONAL_PATH_SEPARATORS, CODE_BLOCK_NAME_SEPARATOR];
const PATH_SEPARATORS_REGEX = new RegExp(PATH_SEPARATORS.join('|'), 'g');
const CODE_BLOCK_NAME_SEPARATOR_REGEX = new RegExp(CODE_BLOCK_NAME_SEPARATOR, 'g');

export function resolvePathRelToVault(path: string, currentPath: string, app: App): string {
	const { file, remainingPath } = findRelativeFile(path, currentPath, app);
	const absPath = file.path;
	if (!remainingPath) return absPath;

	if (!(file instanceof TFile)) {
		throw new UserFacingPluginError(
			'Invalid dependency path',
			`"${path}" points to a folder, but a file or LaTeX code block was expected.`,
			`Resolved "${path}" to folder "${file.path}" with remaining path "${remainingPath}".`,
		);
	}

	if (!isValidFileStem(remainingPath)) {
		throw new UserFacingPluginError(
			'Invalid code block name',
			`"${remainingPath}" is not a valid LaTeX code block name.`,
			undefined,
			true
		);
	}

	const potentialExtension = remainingPath.split('.').pop() ?? '';

	const codeBlockName = remainingPath + (isTexSourceExtension(potentialExtension) ? '' : '.tex');
	return absPath + CODE_BLOCK_NAME_SEPARATOR + codeBlockName;
}

export async function resolveDependencyContent(path: string, app: App): Promise<{ content: string | Uint8Array, sourceType: LatexSourceType }> {
	const parts = path.split(CODE_BLOCK_NAME_SEPARATOR);
	if (parts.length > 2 || parts.length === 0) {
		throw new UserFacingPluginError(
			'Invalid dependency path',
			`"${path}" is not a valid dependency path. Use "${CODE_BLOCK_NAME_SEPARATOR}" only to separate a file path from a code block name.`,
			undefined,
			true
		);
	}
	const filePath = parts.shift()!;
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		throw new UserFacingPluginError(
			'Dependency file not found',
			`Could not find the dependency file "${filePath}". Check that the path is correct and the file exists.`,
		);
	}
	const extension = file.extension.toLowerCase();
	const shouldReadAsText = TEXT_EXTENSIONS.has(extension.toLowerCase());

	const fileContent = shouldReadAsText ? await app.vault.read(file) : new Uint8Array(await app.vault.readBinary(file));
	if (parts.length === 0) return {
		content: fileContent,
		sourceType: LatexSourceType.File
	};

	const codeBlockStem = extractStemAndExtension(parts.shift()!).stem;

	const codeBlocks = await getLatexTaskSectionInfosFromFile(file, app);
	const potentialTargets = codeBlocks.filter(
		(block) => extractCodeBlockName(block.codeBlock) === codeBlockStem,
	);
	const target = potentialTargets.shift();
	if (!target) {
		throw new UserFacingPluginError(
			'LaTeX code block not found',
			`Could not find a LaTeX code block named "${codeBlockStem}" in "${file.path}".`,
		);
	}
	if (potentialTargets.length > 0) {
		throw new UserFacingPluginError(
			'Duplicate LaTeX code block name',
			`More than one LaTeX code block named "${codeBlockStem}" was found in "${file.path}". Code block names used as dependencies must be unique.`,
			undefined,
			true
		);
	}

	const language = extractCodeBlockMetadata(target.codeBlock).language ?? "";
	return {
		content: codeBlockToContent(target.codeBlock),
		sourceType: getLatexCodeBlockDefinition(language).sourceType,
	};
}

/**
 * Finds a file relative to the current file.
 *
 * The path is resolved from the folder containing `currentPath`.
 * It supports `.` and `..` path segments.
 *
 * Code block / section references must be explicit using
 * `CODE_BLOCK_NAME_SEPARATOR`, for example:
 *
 * - `::blockName`
 * - `file.md::blockName`
 * - `../folder/file.md::blockName`
 *
 * @param filePath Path to the target file, optionally followed by a code block name.
 * @param currentPath Path of the source file used as the relative starting point.
 * @returns The resolved file and optional code block / section name.
 */
function findRelativeFile(filePath: string, currentPath: string, app: App) {
	if (currentPath.contains(CODE_BLOCK_NAME_SEPARATOR)) {
		throw new Error(
			`Current path must be a file and not contain code block separator: ${CODE_BLOCK_NAME_SEPARATOR}`,
		);
	}

	const isVaultRoot = currentPath === '' || currentPath === '/';

	const start = isVaultRoot
		? app.vault.getRoot()
		: app.vault.getAbstractFileByPath(currentPath);

	if (!start) {
		throw new Error(`Source path not found: ${currentPath}`);
	}

	const [rawFilePath, remainingPath] = filePath.split(CODE_BLOCK_NAME_SEPARATOR, 2);

	// "::block" means block inside the current file
	if (!rawFilePath) {
		return {
			file: start,
			remainingPath,
		};
	}

	let current = resolveFolder(start);

	const resolved = resolveStartingFolder(rawFilePath, current, start);

	current = resolved.folder;
	const parts = resolved.parts;

	while (parts.length > 1 && current instanceof TFolder) {
		const next = current.children.find((c) => c instanceof TFolder && c.name === parts[0]);

		if (!(next instanceof TFolder)) break;

		current = next;
		parts.shift();
	}

	if (!(current instanceof TFolder)) {
		throw new UserFacingPluginError(
			'Dependency folder not found',
			`Could not find the folder "${parts[0]}" while resolving "${filePath}".`,
			`Invalid folder "${parts[0]}" while resolving "${filePath}" from "${currentPath}".`,
		);
	}

	const fileName = parts.shift();

	if (!fileName) {
		throw new UserFacingPluginError(
			'Invalid dependency path',
			`"${filePath}" does not contain a file name.`,
		);
	}

	const file = current.children.find(
		(c) =>
			c instanceof TFile &&
			(c.name === fileName || (c.basename === fileName && c.name.endsWith('.md'))),
	);

	if (!file) {
		throw new UserFacingPluginError(
			'Dependency file not found',
			`Could not find "${fileName}" in "${current.path || '/'}". Check that the dependency path is correct.`,
			`File "${fileName}" was not found in folder "${current.path}" while resolving "${filePath}" from "${currentPath}".`,
		);
	}

	if (parts.length > 0) {
		throw new UserFacingPluginError(
			'Dependency path not found',
			`Could not resolve "${parts.join('/')}" in dependency path "${filePath}".`,
		);
	}

	return {
		file,
		remainingPath,
	};
}

function resolveFolder(fileOrFolder: TAbstractFile): TFolder {
	if (fileOrFolder instanceof TFile) {
		if (!fileOrFolder.parent) {
			throw new Error(`Source file has no parent folder: ${fileOrFolder.path}`);
		}
		return fileOrFolder.parent;
	} else if (fileOrFolder instanceof TFolder) {
		return fileOrFolder; // can be only TFolder here
	} else {
		throw new Error(`Invalid file or folder: ${fileOrFolder.path}`);
	}
}

function resolveStartingFolder(
	filePath: string,
	current: TFolder,
	start: TAbstractFile,
): { folder: TFolder; parts: string[] } {
	const parts = filePath.split(/[\\/]+/).filter(Boolean);

	while (parts.length > 0) {
		const part = parts[0];

		if (part === '.') {
			parts.shift();
			continue;
		}

		if (part === '..') {
			if (!current.parent) {
				throw new UserFacingPluginError(
					'Invalid dependency path',
					`The dependency path "${filePath}" goes outside the vault.`,
					`Reached the vault root while resolving "${filePath}" from "${start.path}".`,
					true
				);
			}

			current = current.parent;
			parts.shift();
			continue;
		}

		break;
	}

	return {
		folder: current,
		parts,
	};
}

export function extractStemAndExtension(path: string) {
	if (path.split(CODE_BLOCK_NAME_SEPARATOR).length > 2) {
		throw new Error(
			"Invalid path format. Use '" +
			CODE_BLOCK_NAME_SEPARATOR +
			"' to separate file path and code block name.",
		);
	}
	const parts = path
		.split(CODE_BLOCK_NAME_SEPARATOR_REGEX)
		.pop()
		?.split(PATH_SEPARATORS_REGEX)
		.pop()
		?.split('.');
	if (!parts || parts.length < 2) {
		throw new Error(`Invalid path format. Expected a file name with extension: ${path}`);
	}

	const extension = parts.pop()!;
	const stem = parts.join('.');

	return { stem, extension };
}

export function hasExtension(path: string): boolean {
	const normalized = path.replaceAll('\\', '/');
	const fileName = normalized.split('/').pop();

	return !!fileName && fileName.includes('.');
}

/**
 * Extracts the file name from a full cache file path.
 * Example: "/home/user/.obsidian/latex-render-cache/someFile.pdf" -> "someFile.pdf"
 * @param path The full path to the cache file.
 */
export function extractFileName(path: string): string {
	const parts = path.split(PATH_SEPARATORS_REGEX);
	return parts.pop()!;
}

export function isValidFileStem(stem: unknown): boolean {
	if (typeof stem !== 'string') return false;

	if (
		stem === '' ||
		stem.length > 255 ||
		/[<>:"/\\|?*]/.test(stem) ||
		/[. ]$/.test(stem)
	) {
		return false;
	}

	// Check for control characters (ASCII codes 0-31)
	if ([...stem].some((char) => char.charCodeAt(0) < 32)) {
		return false;
	}

	const upper = stem.toUpperCase();
	const reserved = [
		'CON',
		'PRN',
		'AUX',
		'NUL',
		...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
		...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
	];
	if (reserved.includes(upper)) return false;
	return true;
}

export function joinPaths(...paths: string[]): string {
	return normalizePath(
		paths
			.filter(Boolean)
			.map((p) => p.replace(/^\/+|\/+$/g, ''))
			.join('/'),
	);
}
