import {
	Vault,
	TFile,
	TFolder,
	TAbstractFile,
	debounce,
} from 'obsidian';

import LatexCompilerPlugin from 'src/main';

const REFRESH_TIMEOUT_MS = 500;

const refreshAutoUseFiles = debounce(
	(plugin: LatexCompilerPlugin) => {
		plugin.latexRenderer.preprocessor.refresh(false, true);
	},
	REFRESH_TIMEOUT_MS,
	true,
);

export const onFileCreate = (
	plugin: LatexCompilerPlugin,
	file: TAbstractFile,
) => {
	if (!(file instanceof TFile)) return;

	if (isInConfiguredAutoUseDir(plugin, file)) {
		refreshAutoUseFiles(plugin);
	}
};

export const onFileDelete = (
	plugin: LatexCompilerPlugin,
	file: TAbstractFile,
) => {
	if (!(file instanceof TFile)) return;

	if (isInConfiguredAutoUseDir(plugin, file)) {
		refreshAutoUseFiles(plugin);
	}
};

function isInConfiguredAutoUseDir(
	plugin: LatexCompilerPlugin,
	file: TFile,
): boolean {
	const vfsDir =
		plugin.app.vault.getAbstractFileByPath(
			plugin.settings.autoloadedVfsFilesDir,
		);

	if (!vfsDir) return false;

	return isFileInDir(vfsDir, file);
}

function* generateFilesWithin(
	fileOrFolder: TAbstractFile,
): Generator<TFile> {
	if (fileOrFolder instanceof TFile) {
		yield fileOrFolder;
		return;
	}

	if (fileOrFolder instanceof TFolder) {
		for (const child of fileOrFolder.children) {
			yield* generateFilesWithin(child);
		}
	}
}

export function getFilesWithin(
	vault: Vault,
	path: string,
): Set<TFile> {
	const fileOrFolder =
		vault.getAbstractFileByPath(path);

	if (!fileOrFolder) {
		return new Set();
	}

	return new Set(
		generateFilesWithin(fileOrFolder),
	);
}

export function getAutoUseFilePaths(
	vault: Vault,
	path: string,
): Set<string> {
	return new Set(
		[...getFilesWithin(vault, path)]
			.map((file) => file.path),
	);
}

function isFileInFolder(
	dir: TFolder,
	file: TFile,
): boolean {
	let cur = file.parent;

	while (cur && !cur.isRoot()) {
		if (cur.path === dir.path) {
			return true;
		}

		cur = cur.parent;
	}

	return false;
}

function isFileInDir(
	dir: TAbstractFile,
	file: TFile,
): boolean {
	if (dir instanceof TFolder) {
		return isFileInFolder(dir, file);
	}

	return (
		dir instanceof TFile &&
		dir.path === file.path
	);
}