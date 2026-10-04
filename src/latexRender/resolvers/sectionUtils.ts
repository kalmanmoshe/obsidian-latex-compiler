import { MarkdownSectionInformation } from 'obsidian';
import { TaskSectionInformation } from './taskSectionInformation';
import { extractCodeBlockLanguage } from './latexSourceFromFile';

export function sectionToTaskSectionInfo(
	section: MarkdownSectionInformation,
): TaskSectionInformation {
	//the section text is the full text of the file for some reason
	const codeBlock = section.text
        .split('\n')
        .slice(section.lineStart, section.lineEnd + 1)
        .join('\n');
	return {
		lineStart: section.lineStart,
		lineEnd: section.lineEnd,
		codeBlock,
		language: extractCodeBlockLanguage(codeBlock) || "",
	};
}

function taskSectionInfoToCodeBlock(
	fileText: string | string[],
	taskSection: TaskSectionInformation,
): string {
	if (typeof fileText === 'string') {
		fileText = fileText.split('\n');
	}
	return fileText.slice(taskSection.lineStart, taskSection.lineEnd + 1).join('\n');
}

export function taskSectionInfoToContent(
	fileText: string | string[],
	taskSection: TaskSectionInformation,
): string {
	return taskSectionInfoToCodeBlock(fileText, taskSection).split('\n').slice(1, -1).join('\n');
}
