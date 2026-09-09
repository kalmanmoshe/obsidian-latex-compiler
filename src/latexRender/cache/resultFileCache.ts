import LatexCompilerPlugin from 'src/main';
import { FileSystemAdapter, normalizePath, Notice, TFile } from 'obsidian';
import { getLatexHashesFromFile } from '../resolvers/latexSourceFromFile';
import { CacheBase, CacheContent } from './cacheBase/cacheBase';
import {
	CacheEntry,
	CacheJson,
	CacheMap,
	CompilePipeline,
	ResultFileFormat,
} from 'src/settings/settings';
import {
	ResultFilePhysicalCache,
	ResultFileVirtualCache,
} from './resultFileCacheTypes';
import { extractStemAndExtension, resolveDependencyContent } from '../resolvers/paths';
import { hashContent } from './compilerCache';
import { getLatexCodeBlockDefinition } from '../codeBlockTypes';

export const resultFileCacheFormats = new Set<ResultFileFormat>([
	'svg',
	'pdf',
]);

export default class ResultFileCache {
	private plugin: LatexCompilerPlugin;
	/**
	 * Raw source hash -> cached dependency/format variants.
	 */
	private cacheMap: CacheMap;
	private cache: CacheBase;

	constructor(plugin: LatexCompilerPlugin) {
		this.plugin = plugin;

		if (this.plugin.settings.physicalCache) {
			this.cache = new ResultFilePhysicalCache(this.plugin, resultFileCacheFormats);
		} else {
			this.cache = new ResultFileVirtualCache(this.plugin, resultFileCacheFormats);
		}

		void this.onload();
	}

	private async onload() {
		this.loadCache();
		await this.cleanUpCache();
	}

	isPhysicalCache(): boolean {
		return (this.cache instanceof ResultFilePhysicalCache);
	}

	async changeCacheDirectory() {
		if (this.isPhysicalCache()) {
			await (this.cache as ResultFilePhysicalCache).changeCacheDirectory();
		} else {
			const message =
				'Physical cache is not enabled, cannot change cache directory.';
			new Notice(message);
			throw new Error(message);
		}
	}

	private async togglePhysicalCacheOff() {
		if (!this.isPhysicalCache()) {
			console.warn('Physical cache is already disabled, nothing to do.');
			return;
		}
		const physicalCache = this.cache as ResultFilePhysicalCache;
		const fileNames = await physicalCache.listCacheFiles();
		this.cache = new ResultFileVirtualCache(this.plugin, resultFileCacheFormats);
		for (const name of fileNames) {
			const content = await physicalCache.getFile(name);
			if (content === undefined) {
				console.warn(`File ${name} not found in cache, skipping.`);
				continue;
			}
			await this.cache.addFile(name, content);
		}
		await physicalCache.deleteCache();
	}

	private async togglePhysicalCacheOn() {
		if (this.isPhysicalCache()) {
			console.warn('Virtual cache is already disabled, nothing to do.');
			return;
		}
		const virtualCache = this.cache as ResultFileVirtualCache;
		this.cache = new ResultFilePhysicalCache(this.plugin, resultFileCacheFormats);
		const fileNames = await virtualCache.listCacheFiles();
		for (const fileName of fileNames || []) {
			const content = (await virtualCache.getFile(fileName))!;
			await (this.cache as ResultFilePhysicalCache).addFile(fileName, content);
		}
	}

	/**
	 * Toggles the use of physical (on-disk) cache.
	 */
	async togglePhysicalCache() {
		if (this.plugin.settings.physicalCache) {
			await this.togglePhysicalCacheOn();
		} else {
			await this.togglePhysicalCacheOff();
		}
		await this.cleanUpCache();
	}

	private loadCache() {
		const raw: CacheJson = this.plugin.settings.cache || {};
		this.cacheMap = new Map(Object.entries(raw));
	}

	private async saveCache() {
		this.plugin.settings.cache = Object.fromEntries(this.cacheMap);
		await this.plugin.saveSettings();
	}

	/**
	 * Adds a file to the compiled file cache.
	 */
	async addFile(
		content: string | Uint8Array,
		rawHash: string,
		sourcePath: string,
		dependencies: Record<string, string>,
		pipeline: CompilePipeline,
		format: ResultFileFormat
	) {
		if (!this.isValidFileContent(content)) {
			// This should never happen, but if it does, we want to know about it.
			// (PDFs must have headers and SVGs must have a root element, so empty content is invalid.)
			throw new Error(`Cannot add empty content to cache for ${sourcePath} with raw hash ${rawHash}.`);
		};

		let entries = this.cacheMap.get(rawHash);
		if (!entries) {
			entries = [];
			this.cacheMap.set(rawHash, entries);
		}

		await this.removeInvalidCacheEntries(rawHash, entries);
		let targetEntry = entries.find(
			(entry) => this.isEntryEqual(entry, { sourcePath, pipeline, format })
		);

		if (targetEntry) {
			targetEntry.dependencies = dependencies;
		} else {
			targetEntry = {
				format,
				sourcePath,
				pipeline,
				dependencies,
			};

			entries.push(targetEntry);
		}

		const stem = this.getFileStem(rawHash, targetEntry);
		const fileName = this.stemToFileName(stem, format);
		await this.cache.addFile(fileName, content);

		await this.saveCache();
	}

	//TODO: recheck if this is needed, or even if i can merge it with something else
	private async removeInvalidCacheEntries(rawHash: string, entries: CacheEntry[]) {
		const entriesToRemove = new Set<CacheEntry>();
		for (const entry of entries) {
			const fileName = this.getFileName(rawHash, entry);

			if (
				!(await this.cache.fileExists(fileName))
			) {
				entriesToRemove.add(entry);
				continue;
			}
		}

		for (let index = entries.length - 1; index >= 0; index--) {
			if (entriesToRemove.has(entries[index])) {
				entries.splice(index, 1);
			}
		}
	}

	async getResultFile(
		rawHash: string,
		sourcePath: string,
		pipeline: CompilePipeline,
		format: ResultFileFormat
	): Promise<{ stem: string; data: CacheContent } | undefined> {
		const entry = this.cacheMap
			.get(rawHash)
			?.find(
				(entry) => this.isEntryEqual(entry, { sourcePath, pipeline, format })
			);

		if (!entry) {
			return undefined;
		}

		if (!(await this.areDependenciesValid(entry.dependencies))) {
			return undefined;
		}

		return this.getResultFileFromEntry(rawHash, entry);
	}

	private async getResultFileFromEntry(
		rawHash: string,
		entry: CacheEntry,
	) {
		const stem = this.getFileStem(rawHash, entry);
		const fileName = this.stemToFileName(stem, entry.format);
		const data = await this.cache.getFile(fileName);

		if (data === undefined) { return undefined; }
		if (!this.isValidFileContent(data)) {
			await this.removeResultFileFromCache(rawHash, entry.sourcePath, entry.pipeline, entry.format);
			console.error("Cache entry for", fileName, "is empty. Removed from cache.");
			return undefined;
		}

		return { stem, data };
	}

	hasRawHash(rawHash: string): boolean {
		return this.cacheMap.has(rawHash);
	}

	getAllReferencingFilePathsFromCache(): string[] {
		return [
			...new Set(
				Array.from(this.cacheMap.values())
					.flatMap((cacheEntries) =>
						cacheEntries.map((cacheEntry) => cacheEntry.sourcePath))
			),
		];
	}

	private async cleanUpCache(): Promise<void> {
		await this.cache.purgeInvalidCacheFiles();
		await this.ensureCacheIndexMatchesStoredFiles();
		await this.ensureCacheIndexMatchesVault();
		await this.removeInvalidDependencyCacheEntries();
		await this.saveCache();
	}

	/**
	 * remove files that are in the cache but no longer have a matching entry in the cache map.
	 */
	private async ensureCacheIndexMatchesStoredFiles(): Promise<void> {
		const storedFileNames = new Set(await this.cache.listCacheFiles());

		for (const resultFile of storedFileNames) {
			try {
				const { stem, extension } = extractStemAndExtension(resultFile);
				const { rawHash, contextHash } = splitCacheId(stem);
				
				const hasMatchingEntry =
					this.cacheMap
						.get(rawHash)
						?.some(
							(entry) =>
								entry.format === extension &&
								getContextHash(entry.sourcePath, entry.pipeline) === contextHash
						) ?? false;

				if (!hasMatchingEntry) {
					await this.cache.deleteFile(resultFile);
				}
			} catch (err) {
				console.warn(
					`Removing invalid cache file ${resultFile}:`,
					err,
				);

				await this.cache.deleteFile(resultFile);
			}
		}

		const rawHashesToRemove: string[] = [];

		for (const [rawHash, entries] of this.cacheMap) {
			const validEntries = entries.filter((entry) => {
				const fileName = this.getFileName(rawHash, entry);

				return storedFileNames.has(fileName);
			});

			if (validEntries.length === 0) {
				rawHashesToRemove.push(rawHash);
			} else if (validEntries.length !== entries.length) {
				this.cacheMap.set(rawHash, validEntries);
			}
		}

		for (const rawHash of rawHashesToRemove) {
			this.cacheMap.delete(rawHash);
		}
	}

	private async ensureCacheIndexMatchesVault() {
		const filePathsToRemove: string[] = [];
		// Find files that dont exsist anymore if file dose exist, remove unused caches for it.
		for (const filePath of this.getAllReferencingFilePathsFromCache()) {
			const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
			if (!file) {
				filePathsToRemove.push(filePath);
			} else if (file instanceof TFile) {
				try {
					await this.removeUnusedCacheReferencesForFile(file);
				} catch (err) {
					console.error(
						`Error removing cache for file ${filePath}:`,
						err,
					); 
				}
			}
		}
		
		for (const filePath of filePathsToRemove) {
			await this.removeReferencingFileFromCache(filePath);
		}
	}

	/**
	 * Removes unused caches for a specific file.
	 * This checks the LaTeX hashes in the file and removes any hashes from the cache that are not present in the file.
	 * If a hash is no longer referenced by any file, it is removed from the cache.
	 */
	private async removeUnusedCacheReferencesForFile(
		file: TFile,
	): Promise<void> {
		const referencesInFile = await this.getReferencesInFile(file);

		const cachedReferences = this.getCachedReferencesForFile(file.path);

		for (const [rawHash, cachedFormats] of cachedReferences) {
			const formatsInFile = referencesInFile.get(rawHash);

			for (const format of cachedFormats) {
				if (!formatsInFile?.has(format)) {
					await this.removeReference(
						rawHash,
						file.path,
						format,
					);
				}
			}
		}
	}

	private async removeInvalidDependencyCacheEntries() {
		const validatedDependencies = new Map<string, string | null>();

		for (const [rawHash, entries] of this.cacheMap) {
			for (const entry of entries) {
				const areDepsValid = await this.areDependenciesValid(
						entry.dependencies,
						validatedDependencies,
					);
				if (!areDepsValid) {
					
					await this.removeResultFileFromCache(
						rawHash,
						entry.sourcePath,
						entry.pipeline,
						entry.format
					);
				}
			}
		}
	}

	private async getReferencesInFile(
		file: TFile,
	): Promise<Map<string, Set<ResultFileFormat>>> {
		const hashes = await getLatexHashesFromFile(
			file,
			this.plugin.app,
		);

		const references = new Map<string, Set<ResultFileFormat>>();

		for (const { hash, name } of hashes) {
			const format = getLatexCodeBlockDefinition(name).resultFormat;
			addFormatReference(references, hash, format);
		}

		return references;
	}

	private getCachedReferencesForFile(
		filePath: string,
	): Map<string, Set<ResultFileFormat>> {
		const references = new Map<string, Set<ResultFileFormat>>();

		for (const [rawHash, entries] of this.cacheMap) {
			for (const entry of entries) {
				if (entry.sourcePath !== filePath) {
					continue;
				}
				addFormatReference(references, rawHash, entry.format);
			}
		}

		return references;
	}

	private async removeReference(
		rawHash: string,
		filePath: string,
		format?: ResultFileFormat,
	): Promise<void> {
		const entries = this.cacheMap.get(rawHash);
		if (!entries) return;

		const entriesToRemove = entries.filter(
			(entry) =>
				entry.sourcePath === filePath &&
				(format === undefined || entry.format === format),
		);

		for (const entry of entriesToRemove) {
			await this.removeResultFileFromCache(
				rawHash,
				entry.sourcePath,
				entry.pipeline,
				entry.format,
			);
		}
	}

	async removeResultFileFromCache(
		rawHash: string,
		sourcePath: string,
		pipeline: CompilePipeline,
		format: ResultFileFormat,
	): Promise<boolean> {
		const fileName = this.stemToFileName(
			getCacheId(rawHash, sourcePath, pipeline),
			format,
		);

		const fileRemoved = await this.cache.deleteFile(fileName);

		const entries = this.cacheMap.get(rawHash);
		if (!entries) {
			return fileRemoved;
		}

		const index = entries.findIndex((entry) =>
			this.isEntryEqual(entry, {
				sourcePath,
				pipeline,
				format,
			})
		);

		if (index !== -1) {
			entries.splice(index, 1);
		}

		if (entries.length === 0) {
			this.cacheMap.delete(rawHash);
		}

		return fileRemoved || index !== -1;
	}

	private async removeReferencingFileFromCache(
		filePath: string,
	): Promise<void> {
		for (const rawHash of [...this.cacheMap.keys()]) {
			await this.removeReference(rawHash, filePath);
		}
	}

	/**
	 * Removes all cached files from the compiled file cache.
	 */
	async removeAllCached(): Promise<void> {
		await this.cache.clearCache();
		this.cacheMap.clear();
		await this.saveCache();
	}

	private async areDependenciesValid(
		dependencies: Record<string, string>,
		validatedDependencies?: Map<string, string | null>,
	): Promise<boolean> {
		for (const [path, cachedHash] of Object.entries(dependencies)) {
			if (validatedDependencies?.has(path)) {
				const currentHash = validatedDependencies.get(path);

				if (currentHash === null || currentHash !== cachedHash) {
					return false;
				}

				continue;
			}

			try {
				const { content } = await resolveDependencyContent(
					path,
					this.plugin.app,
				);

				const currentHash = hashContent(content);
				validatedDependencies?.set(path, currentHash);

				if (currentHash !== cachedHash) {
					return false;
				}
			} catch {
				// Missing dependency, invalid code-block reference, etc.
				validatedDependencies?.set(path, null);
				return false;
			}
		}

		return true;
	}
	

	private stemToFileName(hash: string, format: ResultFileFormat): string {
		return `${hash}.${format}`;
	}

	getFileStem(rawHash: string, entry: CacheEntry): string {
		return getCacheId(
			rawHash,
			entry.sourcePath,
			entry.pipeline
		)
	}

	getFileName(rawHash: string, entry: CacheEntry): string {
		return this.stemToFileName(this.getFileStem(rawHash, entry), entry.format);
	}

	getAbsolutePathFromStem(stem: string, format: ResultFileFormat): string {
		if (!this.isPhysicalCache()) {
			throw new Error(
				'Physical cache is not enabled, cannot get absolute path from stem.',
			);
		}
		const adapter = this.plugin.app.vault.adapter;

		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error(
				'Vault adapter is not a FileSystemAdapter, cannot get absolute path.',
			);
		}
		const fileName = this.stemToFileName(stem, format);
		const relativePath = (this.cache as ResultFilePhysicalCache).getCacheFilePath(fileName);

		return adapter.getFullPath(normalizePath(relativePath));
	}

	private isValidFileContent(content: CacheContent): boolean {
		if (typeof content === "string") {
			return content.length > 0;
		} else {
			return content.buffer.byteLength > 0;
		}
	}

	private isEntryEqual(
		a: CacheEntry, 
		b: {sourcePath: string, pipeline: CompilePipeline, format: ResultFileFormat}
	): boolean {
		return a.sourcePath === b.sourcePath &&
			a.pipeline === b.pipeline &&
			a.format === b.format;
	}
}

function addFormatReference(
	map: Map<string, Set<ResultFileFormat>>,
	rawHash: string,
	format: ResultFileFormat,
): void {
	let formats = map.get(rawHash);

	if (!formats) {
		formats = new Set<ResultFileFormat>();
		map.set(rawHash, formats);
	}

	formats.add(format);
}

export function getCacheId(
	rawHash: string,
	sourcePath: string,
	pipeline: CompilePipeline,
): string {
	return `${rawHash}-${getContextHash(sourcePath, pipeline)}`;
}

function getContextHash(sourcePath: string, pipeline: CompilePipeline): string {
	return hashContent(
		JSON.stringify([
			normalizePath(sourcePath),
			pipeline,
		]),
	);
}

export function splitCacheId(cacheId: string) {
	const [rawHash, contextHash] = cacheId.split('-');

	if (!rawHash || !contextHash) {
		throw new Error(`Invalid cache id: ${cacheId}`);
	}

	return { rawHash, contextHash };
}