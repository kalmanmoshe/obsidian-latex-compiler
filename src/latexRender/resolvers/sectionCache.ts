import { App, SectionCache, TFile } from 'obsidian';
import { getEditorTextForPath } from '../task/latexTask';
import { codeBlockDelimiterRegex } from '../codeBlockTypes';

//get a better name later
export async function getFileSectionsFromPath(path: string, app: App) {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new Error('File not found');
	//we cant use the file cache
	const source = getEditorTextForPath(file.path, app) ?? (await app.vault.read(file));
	const sections = await getCodeBlockSectionsFromFile(file, app);
	if (!sections) throw new Error('No sections found in metadata');
	return {
		file,
		fileText: source,
		sections: parseCodeBlockSections(source),
	};
}

async function getCodeBlockSectionsFromFile(file: TFile, app: App): Promise<SectionCache[]> {
	const source = getEditorTextForPath(file.path, app) ?? (await app.vault.read(file));
	return parseCodeBlockSections(source);
}

function parseCodeBlockSections(fileText: string) {
	const nestedCodeBlocks = shiftSections(0, parseNestedCodeBlocks(fileText)).map((section) =>
		createSectionCache(fileText, section.start, section.end),
	);
	return nestedCodeBlocks.sort((a, b) => a.position.start.line - b.position.start.line);
}


function parseNestedCodeBlocks(codeBlockText: string): {start: number,end:number}[] {
	const codeBlockLines = codeBlockText.split("\n")
	const startIndex = codeBlockLines.findIndex((line) => codeBlockDelimiterRegex.test(line));
	if (startIndex === -1) return [];
	const codeBlockDelimiter = codeBlockLines[startIndex].match(codeBlockDelimiterRegex)?.[0] as string;

	let endIndex = codeBlockLines.findIndex(
		(line,index) => index > startIndex && 
		line.match(new RegExp(`^\\s*${codeBlockDelimiter.charAt(0)}{${codeBlockDelimiter.length},}\\s*$`))
	);

	if (endIndex === -1) endIndex = codeBlockLines.length-1;
	return [
		{start:startIndex,end:endIndex},
		...shiftSections(startIndex+1,parseNestedCodeBlocks(codeBlockLines.slice(startIndex+1,endIndex).join("\n"))),
		...shiftSections(endIndex+1,parseNestedCodeBlocks(codeBlockLines.slice(endIndex+1).join("\n")))
	]
}

function createSectionCache(source: string, startLine: number, endLine: number): SectionCache {
	return {
		type: 'code',
		position: {
			start: {
				line: startLine,
				col: 0,
				offset: getOffsetForLine(source, startLine),
			},
			end: {
				line: endLine,
				col: source.split('\n')[endLine].trim().length,
				offset: getOffsetForLine(source, endLine),
			},
		},
	};
}

function getOffsetForLine(source: string, lineNumber: number): number {
	return source
		.split('\n')
		.slice(0, lineNumber)
		.reduce((acc, curr) => acc + curr.length + 1, 0); // +1 for \n
}


export function shiftSections(shift: number,sections: {start:number,end:number}[]) {
  return sections.map(({start,end})=>({
      start:start+shift,
      end:end+shift
  }))
}