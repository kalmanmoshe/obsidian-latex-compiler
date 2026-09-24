import { clearFolder } from './compilerCache';
import { PhysicalCacheBase } from './cacheBase/physicalCacheBase';
import { extractFileName, joinPaths } from '../resolvers/paths';
import LatexCompilerPlugin from 'src/main';
import { StringMap } from 'src/settings/settings';

export default class TexLiveCache extends PhysicalCacheBase {

	constructor(plugin: LatexCompilerPlugin) {
		super(plugin);
	}

	setCacheFolderPath(): void {
		this.cacheFolderPath = joinPaths(this.plugin.getCacheDir(), 'texlive-cache');
	}

	async loadTexLiveCache() {
		// add files in the texlive cache folder to the cache list
		const texLiveFiles = await this.listCacheFiles();
		const packageValues = Object.values(this.plugin.settings.texLiveCacheIndex[1]);

		for (const fileName of texLiveFiles) {
			const value = '/tex/' + fileName;

			if (!packageValues.includes(value)) {
				// The engine will try the file across lookup categories.
				// Falling back to the TeX category is sufficient for correctness,
				// though not always optimal for lookup efficiency.
				const key = '26/' + fileName;
				this.plugin.settings.texLiveCacheIndex[1][key] = value;
			}
		}

		const loadedFiles = new Set<string>();

		for (const texLiveFile of texLiveFiles) {
			const fileName = extractFileName(texLiveFile);

			try {
				const content = await this.getFileAsBinary(fileName);

				if (!content) {
					throw new Error(
						`Package cache file not found: ${fileName}`,
					);
				}

				await this.compiler().writeTexFSFile(fileName, content);
				loadedFiles.add(fileName);
			} catch (error) {
				console.error(`Error loading package cache file ${fileName}:`, error);
			}
		}


		await this.plugin.saveSettings();

		const workerIndex = filterCacheIndexToFiles(
			this.plugin.settings.texLiveCacheIndex,
			loadedFiles,
		);

		await this.compiler().writeTexLiveCacheIndex({
			missingPackages: workerIndex[0],
			cachedPackages: workerIndex[1],
			missingFonts: workerIndex[2],
			cachedFonts: workerIndex[3],
		});
	}

	async writeTexLiveCacheIndex() {
		return this.compiler().writeTexLiveCacheIndex({
			missingPackages: this.plugin.settings.texLiveCacheIndex[0],
			cachedPackages: this.plugin.settings.texLiveCacheIndex[1],
			missingFonts: this.plugin.settings.texLiveCacheIndex[2],
			cachedFonts: this.plugin.settings.texLiveCacheIndex[3],
		});
	}

	async fetchTexLiveCacheData(): Promise<void> {
		try {
			const cacheData = await this.compiler().fetchCacheData();

			const knownFileNames = new Set(
				(await this.listCacheFiles())
					.map((path) => extractFileName(path)),
			);

			const files: {
				name: string;
				content: Uint8Array<ArrayBuffer>;
			}[] = [];

			for (const [engineIndex, engineCacheData] of cacheData.entries()) {

				const newFileNames = [
					...new Set(
						engineCacheData.downloadedTexLiveFiles
							.map((path) => extractFileName(path))
							.filter((fileName) => !knownFileNames.has(fileName)),
					),
				];

				/*
				* Mark them before processing the next engine so another
				* worker does not report the same shared file as new.
				*/
				for (const fileName of newFileNames) {
					knownFileNames.add(fileName);
				}

				if (newFileNames.length === 0) { continue; }

				const engineFiles = await this.compiler().fetchTexFiles(
					engineIndex,
					newFileNames,
				);

				files.push(...engineFiles);
			}

			for (const file of files) {
				await this.addFile(file.name, file.content);
			}
			// Always add, never remove.
			// The index is synced across devices, while the physical cache is device-local.	
			this.plugin.settings.texLiveCacheIndex = [
				{
					...this.plugin.settings.texLiveCacheIndex[0],
					...mergeRecords(cacheData.map((data) => data.missingPackages)),
				},
				{
					...this.plugin.settings.texLiveCacheIndex[1],
					...mergeRecords(cacheData.map((data) => data.cachedPackages)),
				},
				{
					...this.plugin.settings.texLiveCacheIndex[2],
					...mergeRecords(cacheData.map((data) => data.missingFonts)),
				},
				{
					...this.plugin.settings.texLiveCacheIndex[3],
					...mergeRecords(cacheData.map((data) => data.cachedFonts)),
				},
			];

			await this.plugin.saveSettings();
		} catch (err) {
			console.error('Error fetching package cache data:', err);
		}
	}

	/**
	 * Remove all cached package files from the file system and update the settings.
	 */
	async removeAllCachedPackages(): Promise<void> {
		await clearFolder(this.plugin.app.vault.adapter, this.getCacheFolderPath());
	}

	private compiler() {
		if (!this.plugin.latexRenderer.isCompilerEnabled()) {
			throw new Error('Package cache is not supported on this device because the compiler is disabled.');
		}
		return this.plugin.latexRenderer.compiler;
	}
}

function mergeRecords<T extends object>(records: readonly T[]): T {
	return Object.assign({}, ...records) as T;
}

function filterRecordToFiles(
    record: StringMap,
    files: ReadonlySet<string>,
): StringMap {
    return Object.fromEntries(
        Object.entries(record).filter(([, path]) =>
            files.has(extractFileName(String(path))),
        ),
    );
}

function filterCacheIndexToFiles(
    index: StringMap[],
    files: ReadonlySet<string>,
): StringMap[] {
    return [
        index[0],
        filterRecordToFiles(index[1], files),
        index[2],
        filterRecordToFiles(index[3], files),
    ];
}