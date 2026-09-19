import { DataAdapter, normalizePath } from 'obsidian';
import { Md5 } from 'ts-md5';
import LatexCompilerPlugin from 'src/main';
import ResultFileCache from './resultFileCache';
import { ProcessedLog } from '../logs/latexLogParser';
import PackageCache from './packageCache';
import LogCache from './logCache';
import { LatexRenderCompilationSession } from '../latexRenderCompilationSession';

export function hashString(input: string, length = 16): string {
	return Md5.hashStr(input).slice(0, length);
}

export function hashContent(
	input: string | Uint8Array,
	length = 16,
): string {
	const hasher = new Md5();

	if (typeof input === 'string') {
		hasher.appendStr(input);
	} else {
		hasher.appendByteArray(input);
	}

	const hash = hasher.end();

	if (typeof hash !== 'string') {
		throw new Error('Failed to generate MD5 hash.');
	}
	return hash.slice(0, length);
}

export function getDependencyHash(dependencies: string[]): string {
	if (dependencies.length === 0) {
		return 'nodeps';
	}
	const sorted = [...dependencies].sort();
	const joined = sorted.join('\n');
	return hashString(joined, 16);
}

export function hashLatexContent(content: string) {
	return hashString(content, 16);
}

/**
 * Manages caching for LaTeX files, logs, and packages.
 */
export default class CompilerCache {
	/** Reference to the main plugin instance. */
	private plugin: LatexCompilerPlugin;
	/** Handles caching of compiled files. */
	resultFileCache: ResultFileCache;
	/** Handles caching of LaTeX packages. */
	private packageCache: PackageCache;
	/** Handles caching of compilation logs. */
	private logCache: LogCache;

	/**
	 * Initializes the compiler cache and ensures the cache directory exists.
	 * @param plugin The main plugin instance.
	 */
	constructor(plugin: LatexCompilerPlugin) {
		this.plugin = plugin;
		this.resultFileCache = new ResultFileCache(this.plugin);
		this.packageCache = new PackageCache(this.plugin);
		this.logCache = new LogCache(this.plugin);
	}

	/**
	 * Fetches cached package data.
	 */
	fetchPackageCacheData() {
		return this.packageCache.fetchPackageCacheData();
	}

	/**
	 * Retrieves a cached log by hash.
	 * @param logCacheKey The key for the log in the cache.
	 */
	getLog(logCacheKey: string) {
		return this.logCache.getLog(logCacheKey);
	}

	async forceGetLog(
		logCacheKey: string,
		config: { source: string; sourcePath: string },
	) {
		const log =
			this.getLog(logCacheKey) ||
			(await this.logCache.forceGetLog(logCacheKey, config));
		if (!log) {
			throw new Error(
				'No log found for this hash, nor was one able to be produced.',
			);
		}
		return log;
	}

	/**
	 * Adds a log to the log cache.
	 * @param log The log object or string.
	 * @param logCacheKey The key for the log in the cache.
	 */
	addLog(
		logCacheKey: string, log: ProcessedLog | string, session: LatexRenderCompilationSession) {
		this.logCache.addLog(logCacheKey, log, session);
	}

	/**
	 * Loads the package cache from disk.
	 */
	loadPackageCache() {
		return this.packageCache.loadPackageCache();
	}

	/**
	 * Removes all cached packages.
	 */
	async removeAllCachedPackages() {
		return this.packageCache.removeAllCachedPackages();
	}

	/**
	 * Unloads the cache and flushes the compiler cache.
	 */
	async unloadCache() {
		await this.plugin.latexRenderer.compiler?.flushCache();
		await this.resultFileCache.removeAllCached();
	}
}

/**
 * Recursively clears all files and folders in the given folder path.
 * @param folderPath The path to the folder to clear.
 */
export async function clearFolder(
	adapter: DataAdapter,
	folderPath: string,
): Promise<void> {
	if (!(await adapter.exists(folderPath))) {
		return;
	}

	await adapter.rmdir(folderPath, true);
	await mkdirRecursive(adapter, folderPath);
}

export async function mkdirRecursive(adapter: DataAdapter, path: string): Promise<void> {
	const normalized = normalizePath(path);
	const parts = normalized.split("/").filter(Boolean);

	let current = "";

	for (const part of parts) {
		current = current ? `${current}/${part}` : part;

		if (!(await adapter.exists(current))) {
			await adapter.mkdir(current);
		}
	}
}
