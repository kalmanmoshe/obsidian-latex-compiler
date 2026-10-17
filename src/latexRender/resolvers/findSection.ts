import { App, MarkdownSectionInformation, SectionCache, } from 'obsidian';
import { getFileSectionsFromPath } from './sectionCache';

/**
 * Tries to find a code block section by exact or fuzzy string match against the file content.
 * i need to faze this out
 */
export async function findMatchingCodeBlockSections(
	path: string,
	codeBlock: string,
	app: App
): Promise<MarkdownSectionInformation[] | undefined> {
	const { fileText, sections } = await getFileSectionsFromPath(path, app);

	const sectionMatches: SectionCache[] | undefined = extractPossibleSectionCatchesOfString(
		sections,
		fileText,
		codeBlock,
	)?.filter((sec) => sec.position);

	if (!sectionMatches || sectionMatches.length === 0) return;

	return sectionMatches.map((sectionCache) => ({
		lineStart: sectionCache.position.start.line,
		lineEnd: sectionCache.position.end.line,
		text: fileText,
	}));
}

function extractPossibleSectionCatchesOfString(
	sectionsCache: SectionCache[],
	fileText: string,
	target: string,
	exact = false,
): SectionCache[] | undefined {
	const sourceLineIndexes = getAllLineStartIndexesOfString(fileText, target);
	const possibleSections = sourceLineIndexes
		.map((idx) => findInnermostSection(sectionsCache, idx - 1))
		.filter((sec) => sec != undefined);

	if (!exact || possibleSections.length === 0) {
		return possibleSections.length > 0 ? possibleSections : undefined;
	}

	const exactSections = possibleSections.filter((sec) =>
		sourceLineIndexes.includes(sec.position.start.line),
	);
	return exactSections.length > 0 ? exactSections : undefined;
}

/**
 * Returns the most nested (deepest) section that contains a given line.
 */
function findInnermostSection(
	sections: SectionCache[],
	lineIndex: number,
	lineEnd?: number,
): SectionCache | undefined {
	return sections
		.filter(
			(sec) =>
				sec.position.start.line <= lineIndex &&
				sec.position.end.line >= lineIndex &&
				(lineEnd ? sec.position.end.line <= lineEnd : true),
		)
		.sort((a, b) => b.position.start.line - a.position.start.line)[0];
}

/**
 * zero-based index of the first line of a multi-line string in a file text.
 * @param fileText
 * @param searchString
 * @returns
 */
function getAllLineStartIndexesOfString(fileText: string, searchString: string): number[] {
	const textLines = fileText.split('\n'); // Split the full text into lines
	const searchLines = searchString.split('\n'); // Split the search string into lines
	const searchLength = searchLines.length;
	const indexes: number[] = [];
	for (let i = 0; i <= textLines.length - searchLength; i++) {
		let match = true;

		for (let j = 0; j < searchLength; j++) {
			if (textLines[i + j] !== searchLines[j]) {
				match = false;
				break;
			}
		}

		if (match) {
			indexes.push(i);
		}
	}
	return indexes;
}
