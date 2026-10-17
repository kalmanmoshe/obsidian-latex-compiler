/**
 * Naming convention for cached files:
 * 	path      = "folder/archive.tar.gz"
 * 	dir       = "folder"
 * 	fileName  = "archive.tar.gz"
 * 	stem      = "archive.tar"
 * 	extension = "gz"
 */
import LatexCompilerPlugin from 'src/main';
import {
	extractStemAndExtension,
	isValidFileStem,
} from 'src/latexRender/resolvers/paths';
import { CacheFileType, getFileReadType } from 'src/latexRender/resolvers/extensions';

export type CacheContent = string | Uint8Array;

export abstract class CacheBase {
	constructor(
		protected plugin: LatexCompilerPlugin,
		protected allowedExtensions?: Set<string>
	) { }

	/**
	 * Returns a map of all cached files with their names and content.
	 * The key is the file name (with extension), and the value is the file content.
	 */
	abstract getFiles(): Promise<Map<string, CacheContent>>;
	/**
	 * Checks if the file is a valid cache file that is in the cache directory.
	 * @param fileName - the name of the file to check including extension.
	 */
	abstract fileExists(fileName: string): Promise<boolean>;

	getFile(fileName: string): Promise<CacheContent | undefined> {
		const type = this.getFileType(fileName);

		if (type === CacheFileType.Text) {
			return this.getFileAsString(fileName);
		} else if (type === CacheFileType.Binary) {
			return this.getFileAsBinary(fileName);
		} else {
			throw new Error(`Unknown cache file type: ${fileName}`);
		}
	}

	abstract getFileAsString(fileName: string): Promise<string | undefined>;
	abstract getFileAsBinary(fileName: string): Promise<Uint8Array | undefined>;

	/**
	 *
	 * @param fileName - the name of the file to delete including extension.
	 * Returns true if the file was successfully deleted, false otherwise or if didn't exist.
	 */
	abstract deleteFile(fileName: string): Promise<boolean>;

	abstract addFile(
		fileName: string,
		content: CacheContent,
	): Promise<void>;

	/**
	 * Returns list of cached file names (with extension).
	 */
	abstract listCacheFiles(): Promise<string[]>;
	abstract purgeInvalidCacheFiles(): Promise<void>;
	abstract clearCache(): Promise<void>;
	abstract deleteCache(): Promise<void>;

	protected getFileType(fileName: string): CacheFileType {
		return getFileReadType(fileName);
	}

	isValidFileName(fileName: unknown) {
		if (
			!fileName ||
			typeof fileName !== 'string' ||
			fileName.trim() === ''
		) {
			return false;
		}
		const { stem, extension } = extractStemAndExtension(fileName);
		return (
			isValidFileStem(stem) &&
			this.isValidFileExtension(extension)
		);
	}

	isValidFileExtension(extension: unknown) {
		if (
			!extension ||
			typeof extension !== 'string' ||
			extension.trim() === ''
		) {
			return false;
		}
		return this.allowedExtensions ? this.allowedExtensions.has(extension) : true;
	}

	/**
	 * Ensures the provided file name is valid, throwing an error if not.
	 * @param fileName - the name of the file to validate.
	 * @returns The validated file name.
	 */
	ensureIsValidFileName(fileName: string): string {
		const { stem, extension } = extractStemAndExtension(fileName);
		this.ensureIsValidFileExtension(extension);
		this.ensureIsValidFileStem(stem);

		return fileName;
	}

	ensureIsValidFileStem(stem: string): string {
		if (!isValidFileStem(stem)) {
			throw new Error(`Invalid file stem: ${stem}`);
		}
		return stem;
	}

	ensureIsValidFileExtension(extension: string): string {
		if (!this.isValidFileExtension(extension)) {
			throw new Error(
				`Invalid file extension: ${extension}. Valid extensions are: ${Array.from(this.allowedExtensions || []).join(', ')}`,
			);
		}
		return extension;
	}
}

/**
 * Checks if the provided file stem is valid.
 * @param stem - the stem of the file to check.
 * @returns
 */
export const fileStemRegex = /[a-zA-Z0-9]*/;