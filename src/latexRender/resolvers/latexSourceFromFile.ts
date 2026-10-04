import { App, TFile } from 'obsidian';
import { getLatexTaskSectionInfosFromFile } from './taskSectionInformation';
import { codeBlockToContent } from 'obsidian-dev-utils';
import { hashLatexContent } from '../cache/compilerCache';
import { latexCodeBlockLanguageRegex } from '../codeBlockTypes';

export async function extractAllSectionsByFile(app: App) {
	const files = app.vault.getFiles().filter((f) => f.extension === 'md');
	const sectionsByFile = await Promise.all(
		files.map(async (file) => ({
			file,
			codeBlockSections: await getLatexTaskSectionInfosFromFile(file, app),
		})),
	);
	return sectionsByFile;
}

export function extractCodeBlockMetadata(text: string): {
	language?: string;
	name?: string;
} {
	const language = extractCodeBlockLanguage(text);
	const name = extractCodeBlockName(text);
	return { language, name };
}

export function extractCodeBlockLanguage(text: string): string | undefined {
	return text.split('\n')[0].match(latexCodeBlockLanguageRegex)?.[1];
}

/**
 * Attempts to extract the name of a LaTeX code block from the first line of the given text.
 * @param codeBlock - The full text of the code block
 * @returns The extracted name if matched, otherwise undefined
 */
export function extractCodeBlockName(codeBlock: string): string | undefined {
	const nameMatch = codeBlock
		.split('\n')[0]
		.replace(latexCodeBlockLanguageRegex, '')
		.trim()
		.match(/name: *([-\wא-ת.]+)/); // Match names with letters, numbers, underscores, dashes, and Hebrew characters
	return nameMatch ? nameMatch[1] : undefined;
}
/**
 * Extracts all latex code blocks from a file and returns their hashes.
 * @param file
 * @param app
 * @returns
 */
export async function getLatexHashesFromFile(file: TFile, app: App) {
	const codeBlocks = await getLatexTaskSectionInfosFromFile(file, app);
	const hashes = codeBlocks.map((block) => ({
		hash: hashLatexContent(codeBlockToContent(block.codeBlock)),
		name: extractCodeBlockLanguage(block.codeBlock)! //(the code blocks are already filtered to be latex or tikz, so this should always return a value)
	}));
	return hashes;
}
