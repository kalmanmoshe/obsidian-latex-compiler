
export interface ErrorMessage {
	title: string;
	explanation?: string;
	triggeringPackage?: string;
	cause?: string;
	line?: number;
}

export enum ErrorLevel {
	Error = 'error',
	Warning = 'warning',
	Typesetting = 'typesetting',
	Info = 'info',
}

export function errorMessageDiv(
	info: ErrorMessage,
	level: ErrorLevel = ErrorLevel.Error,
): HTMLElement {
	const {
		title,
		cause,
		line,
		explanation,
		triggeringPackage,
	} = info;

	const container = createFragment().createDiv({
		cls: ['latex-compiler-error-container', `level-${level}`],
	});

	const content = container.createDiv({
		cls: 'latex-compiler-error-content',
	});

	const errorDetails = [
		['latex-compiler-error-title', title],
		['latex-compiler-error-explanation', explanation],
		[
			'latex-compiler-error-cause',
			cause && `Triggered from ${cause}`,
		],
		[
			'latex-compiler-error-package',
			triggeringPackage
				? `Package: ${triggeringPackage}`
				: undefined,
		],
		[
			'latex-compiler-error-line',
			line ? `At line: ${line}` : undefined,
		],
	];

	for (const [className, textContent] of errorDetails) {
		if (!textContent) continue;

		content.createDiv({ cls: className, text: textContent });
	}

	return container;
}
