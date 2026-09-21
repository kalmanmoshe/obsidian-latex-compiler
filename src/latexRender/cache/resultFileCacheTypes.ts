import { Notice } from 'obsidian';
import { PhysicalCacheBase } from './cacheBase/physicalCacheBase';
import { VirtualCacheBase } from './cacheBase/virtualCacheBase';
import { joinPaths } from '../resolvers/paths';
import { mkdirRecursive } from './compilerCache';

// This is just for naming consistency with the physical cache.
export class ResultFileVirtualCache extends VirtualCacheBase { }

export class ResultFilePhysicalCache extends PhysicalCacheBase {

	setCacheFolderPath() {
		let folderPath = '';
		const cacheDir = this.plugin.settings.physicalCacheLocation;
		if (cacheDir) {
			folderPath = cacheDir === '/' ? '' : cacheDir
		} else {
			folderPath = this.plugin.getCacheDir();
		}

		this.cacheFolderPath = joinPaths(folderPath, 'result-cache');
	}

	/**
	 * Changes the cache directory location.
	 */
	async changeCacheDirectory() {
		if (!this.plugin.settings.physicalCache) {
			new Notice(
				'Physical cache is not enabled, cannot change cache directory.',
			);
			return;
		}

		const oldCacheFiles = await this.listCacheFiles();
		const oldCacheFolderPath = this.cacheFolderPath;
		this.setCacheFolderPath();
		const newCacheFolderPath = this.getCacheFolderPath();

		if (newCacheFolderPath === oldCacheFolderPath) {
			new Notice(
				'Cache directory is already set to the specified location.',
			);
			return;
		}
		const adapter = this.plugin.app.vault.adapter;
		await mkdirRecursive(adapter, newCacheFolderPath);

		for (const file of oldCacheFiles) {
			const oldPath = joinPaths(oldCacheFolderPath, file);
			const newPath = joinPaths(newCacheFolderPath, file);

			try {
				if (await adapter.exists(oldPath)) {
					await adapter.rename(oldPath, newPath);
				}
			} catch (err) {
				console.error(`Failed to move file ${file}:`, err);
			}
		}

		try {
			if (await adapter.exists(oldCacheFolderPath)) {
				await adapter.rmdir(oldCacheFolderPath, true);
			}
		} catch (err) {
			console.error(
				`Failed to remove old cache folder ${oldCacheFolderPath}:`,
				err,
			);
		}
	}
}
