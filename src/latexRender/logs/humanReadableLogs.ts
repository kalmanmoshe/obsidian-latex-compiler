import { ErrorMessage } from '../errors/errorDisplay';
import LatexLogParser, { CurrentError, ProcessedLog } from './latexLogParser';

export default function parseLatexLog(
	rawLog: string,
	ignoreDuplicates: boolean = true,
): ProcessedLog {
	return new LatexLogParser(rawLog, ignoreDuplicates).parse();
}

export function refactorLogToErrorMessage(err: ProcessedLog): ErrorMessage {
	if (err.errors.length === 0) {
		return {
			title: 'Unknown LaTeX error',
			explanation: err.raw,
		}
	} 
	// If there are multiple errors, we can choose to display the first one (The one that most probably caused the compilation to fail) for simplicity.
	return logEntryToErrorMessage(err.errors[0]);
}

export function logEntryToErrorMessage(entry: CurrentError): ErrorMessage {
	return {
		title: entry.message,
		cause: entry.cause || entry.content,
		line: entry.line || undefined,
	};
}