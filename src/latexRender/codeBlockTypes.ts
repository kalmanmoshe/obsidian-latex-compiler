import { CompilePipeline, ResultFileFormat } from 'src/settings/settings';

export interface LatexCodeBlockDefinition{
	compilePipeline: CompilePipeline;
	resultFormat?: ResultFileFormat;
	render: boolean;
}

export const LATEX_CODE_BLOCKS = {
	latex: {
		compilePipeline: CompilePipeline.Plain,
		resultFormat: 'pdf',
		render: true,
	},

	latexsvg: {
		compilePipeline: CompilePipeline.Plain,
		resultFormat: 'svg',
		render: true,
	},

	tikz: {
		compilePipeline: CompilePipeline.Process,
		resultFormat: 'svg',
		render: true,
	},

	"latex-file": {
		compilePipeline: CompilePipeline.Plain,
		render: false,
	},

} satisfies Record<string, LatexCodeBlockDefinition>;

export type LatexCodeBlockLanguage = keyof typeof LATEX_CODE_BLOCKS;
// i sort so for example "latex-file" is matched before "latex" in the regex, otherwise it would never match "latex-file"
const codeBlockLanguagePattern = Object.keys(LATEX_CODE_BLOCKS)
	.sort((a, b) => b.length - a.length)
	.join('|');

export const codeBlockDelimiterRegex = /^\s*(?:`{3,}|~{3,})/;

export const latexCodeBlockLanguageRegex = new RegExp(
	`${codeBlockDelimiterRegex.source}\\s*(${codeBlockLanguagePattern})(?=\\s|$)`,
	'i',
);

export function getLatexCodeBlockDefinition(
	language: string,
): LatexCodeBlockDefinition {
	const definition =
		LATEX_CODE_BLOCKS[
			language.toLowerCase() as LatexCodeBlockLanguage
		];

	if (!definition) {
		throw new Error(
			`Unsupported LaTeX code block language: ${language}`,
		);
	}

	return definition;
}