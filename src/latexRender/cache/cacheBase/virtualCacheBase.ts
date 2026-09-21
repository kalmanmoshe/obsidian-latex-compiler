import { extractFileName } from 'src/latexRender/resolvers/paths';
import { CacheBase, CacheContent } from './cacheBase';

export abstract class VirtualCacheBase extends CacheBase {
	/**
	 * @key: name of the file with extension
	 * @value: content of the file
	 */
	protected cache: Map<string, CacheContent> = new Map();

	async fileExists(fileName: string) {
		return this.cache.has(fileName) || false;
	}

	async getFileAsString(fileName: string): Promise<string | undefined> {
		const content = this.cache.get(fileName);

		if (content === undefined) return undefined;

		if (typeof content !== "string") {
			throw new Error(`"${fileName}" contains binary data.`);
		}

		return content;
	}

	async getFileAsBinary(fileName: string): Promise<Uint8Array | undefined> {
		const content = this.cache.get(fileName);

		if (content === undefined) return undefined;

		if (!(content instanceof Uint8Array)) {
			throw new Error(`"${fileName}" contains text data.`);
		}

		return content;
	}

	async getFiles(): Promise<Map<string, CacheContent>> {
		const newCache = new Map<string, CacheContent>();
		this.cache.forEach((value, key) =>
			newCache.set(extractFileName(key), value),
		);
		return newCache;
	}

	async addFile(fileName: string, content: CacheContent) {
		this.cache.set(fileName, content);
	}

	async deleteFile(fileName: string) {
		if (this.cache.has(fileName)) {
			this.cache.delete(fileName);
			return true;
		}
		return false;
	}

	async listCacheFiles() {
		return [...(this.cache.keys() || [])];
	}

	async deleteCache() {
		// its virtual cache, so we just clear the map
		this.cache.clear();
	}

	async clearCache() {
		this.cache.clear();
	}

	async purgeInvalidCacheFiles(): Promise<void> {
		const keys = [...this.cache.keys()];
		keys.forEach((key) => {
			if (!this.isValidFileName(key)) {
				this.cache.delete(key);
			}
		});
	}
}
