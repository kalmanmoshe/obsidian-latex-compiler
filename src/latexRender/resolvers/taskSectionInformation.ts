import { App, SectionCache, TFile } from 'obsidian';
import { getFileSectionsFromPath } from './sectionCache';
import { codeBlockToContent } from 'obsidian-dev-utils';
import { hashLatexContent } from '../cache/compilerCache';
import { latexCodeBlockLanguageRegex } from '../codeBlockTypes';
export interface TaskSectionInformation {
	/**
	 * The line start of the source in the file. (zero-based index)
	 */
	lineStart: number;
	/**
	 * The line end of the source in the file. (zero-based index)
	 */
	lineEnd: number;
	/**
	 * the source code of the task (the code block) including the delimiters.
	 */
	codeBlock: string;

	language: string;
}

/**
 * extracts all latex code blocks from a file.
 * @param plugin
 * @param file
 * @returns
 */
export async function getLatexTaskSectionInfosFromFile(file: TFile, app: App) {
	const { fileText, sections } = await getFileSectionsFromPath(file.path, app);
	if (!sections) return [];
	return getLatexTaskSectionInfosFromString(fileText, sections);
}

/**
 * Converts code sections into LaTeX code block objects containing start line, end line, and the full code block text.
 * including both the opening and closing code block delimiters (i.e., the ``` lines).
 *
 * @param string - The full text of the file.
 * @param sections - An array of SectionCache items representing code block positions.
 * @returns An array of TaskSectionInformation one for each LaTeX/TikZ code block.
 */
function getLatexTaskSectionInfosFromString(
	string: string,
	sections: SectionCache[],
): TaskSectionInformation[] {
	const lines = string.split('\n');
	// Filter sections that are code blocks with latex or tikz language hints.
	sections = sections.filter((section: SectionCache) => section.type === 'code');
	let codeBlocks: TaskSectionInformation[] = [];
	for (const section of sections) {
		const codeBlock = lines
			.slice(section.position.start.line, section.position.end.line + 1)
			.join('\n');
		const language = codeBlock.split('\n')[0].match(latexCodeBlockLanguageRegex)?.[1];
		if (!language) continue;
		codeBlocks.push({
			lineStart: section.position.start.line,
			lineEnd: section.position.end.line,
			codeBlock: codeBlock,
			language: language,
		});
	}
	codeBlocks = codeBlocks.sort((a, b) => a.lineStart - b.lineStart);
	return codeBlocks;
}

export async function findTaskSectionInfoFromHashInFile(
	file: TFile, 
	hash: string, 
	language: string, 
	app: App
) {
	const blockSections = await getLatexTaskSectionInfosFromFile(file, app);
	const matchedSections = blockSections.filter(
		(section) => hashLatexContent(codeBlockToContent(section.codeBlock)) === hash 
		&& section.language === language,
	);
	if (matchedSections.length === 0) {
		return undefined;
	}
	return matchedSections;
}
