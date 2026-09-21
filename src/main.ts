import { Plugin, Notice } from 'obsidian';
import { LatexCompilerPluginSettings, DEFAULT_SETTINGS, DEFAULT_LOCAL_STORAGE_SETTINGS, LocalStorageSettings, LOCAL_STORAGE_KEY } from './settings/settings';
import { LatexCompilerSettingTab } from './settings/settingsTab';
import { getEditorCommands } from './obsidian/editorCommands';
import { LatexRenderer } from './latexRender/latexRenderer';
import {
	onFileCreate,
	onFileDelete,
} from './obsidian/fileWatch';
import { LatexContextMenuDecider } from './latexRender/contextMenu/latexContextMenuDecider';
import { LATEX_CODE_BLOCKS } from './latexRender/codeBlockTypes';

type WindowWithCodeMirror = Window & {
	CodeMirror?: {
		modeInfo: {
			name: string;
			mime: string;
			mode: string;
		}[];
	};
};
export default class LatexCompilerPlugin extends Plugin {
	settings: LatexCompilerPluginSettings;
	latexRenderer: LatexRenderer = new LatexRenderer();
	menuDecider: LatexContextMenuDecider;
	private cacheDir: string;

	async onload() {
		const startTime = performance.now();
		console.log('Loading Latex Compiler plugin');
		this.menuDecider = new LatexContextMenuDecider(this);

		await this.loadSettings();

		this.addSyntaxHighlighting();
		this.app.workspace.onLayoutReady(async () => {
			const onStart = performance.now();
			await this.loadLayoutReadyDependencies();
			console.warn(
				'Latex Compiler Plugin layout ready in ' + (performance.now() - onStart) + 'ms',
			);
		});
		this.addSettingTab(new LatexCompilerSettingTab(this));
		console.warn('Latex Compiler Plugin loaded in ' + (performance.now() - startTime) + 'ms');
	}

	onunload() {
		this.removeSyntaxHighlighting();
		void this.latexRenderer.onunload();
	}

	private async loadLayoutReadyDependencies() {
		await this.setCacheDir();
		// we need to use await here because the codeBlock processor
		// needs to be loaded before the codeBlocks are processed
		await this.latexRenderer.onload(this);
		this.latexRenderer.preprocessor.refresh(true);
		// processing of the code blocks have layout dependencies
		try {
			this.setCodeblocks();
		} catch (e) {
			console.error('Error setting code blocks:', e);
			new Notice('Error setting code blocks. Please check the console for more details.');
		}
		this.watchFiles();
		//some commands are only available when the compiler is enabled, so we need to check that before adding them
		this.addEditorCommands();
	}

	private setCodeblocks() {
		//each one refreshes so for each new processor, the block would be rendered multiple times. 
		// (that only hapens once on load, and the queue takes care of most of it)
		for (const [language, definition] of Object.entries(LATEX_CODE_BLOCKS)) {
			this.registerMarkdownCodeBlockProcessor(
				language,
				(source, el, ctx) =>
					this.latexRenderer.codeBlockProcessor(
						source,
						el,
						ctx,
						definition,
					),
			);
		}
	}

	private addSyntaxHighlighting() {
		const codeMirror = (activeWindow as WindowWithCodeMirror).CodeMirror;
		if (!codeMirror) return;

		for (const language of Object.keys(LATEX_CODE_BLOCKS)) {
			if (language === 'latex') continue;

			if (!codeMirror.modeInfo.some(
				info => info.name.toLowerCase() === language.toLowerCase()
			)) {
				codeMirror.modeInfo.push({
					name: language,
					mime: 'text/x-latex',
					mode: 'stex',
				});
			}
		}
	}

	private removeSyntaxHighlighting() {
		const codeMirror = (activeWindow as WindowWithCodeMirror).CodeMirror;
		if (!codeMirror) return;

		const customLanguages = new Set(
			Object.keys(LATEX_CODE_BLOCKS)
				.filter(language => language !== 'latex')
				.map(language => language.toLowerCase()),
		);

		codeMirror.modeInfo = codeMirror.modeInfo.filter(
			info => !customLanguages.has(info.name.toLowerCase()),
		);
	}

	private addEditorCommands() {
		const editorCommands = getEditorCommands(this).filter((command) => command !== undefined);
		for (const command of editorCommands) {
			this.addCommand(command);
		}
	}

	private async loadSettings() {
		let data: unknown = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		await this.saveSettings();
	}

	async saveSettings(didLatexFileLocationChange = false) {
		await this.saveData(this.settings);

		this.latexRenderer.ensurePreprocessor();

		if (didLatexFileLocationChange) {
			this.app.workspace.onLayoutReady(() => {
				this.latexRenderer.preprocessor.refresh(true);
			});
		}
	}

	getLocalStorageSettings(): LocalStorageSettings {
		const stored = this.app.loadLocalStorage(
			LOCAL_STORAGE_KEY,
		) as Partial<LocalStorageSettings> | null;

		return {
			...DEFAULT_LOCAL_STORAGE_SETTINGS,
			...(stored ?? {}),
		};
	}

	saveLocalStorageSetting<
		K extends keyof LocalStorageSettings,
	>(
		key: K,
		value: LocalStorageSettings[K],
	): void {
		const current =
			(this.app.loadLocalStorage(
				LOCAL_STORAGE_KEY,
			) as Partial<LocalStorageSettings> | null) ?? {};

		this.app.saveLocalStorage(LOCAL_STORAGE_KEY, {
			...current,
			[key]: value,
		});
	}

	private watchFiles() {
		this.registerEvent(this.app.vault.on("rename", () => this.latexRenderer.preprocessor.refresh(false, true)));
		this.registerEvent(this.app.vault.on("delete", (file) => onFileDelete(this, file)));
		this.registerEvent(this.app.vault.on("create", (file) => onFileCreate(this, file)));
	}

	getCacheDir(): string { return this.cacheDir; }
	//must be in the plugin dir as if not the cache will not be deleted when the plugin is uninstalled
	private async setCacheDir(): Promise<void> {
		const pluginDir = await this.resolvePluginDir();

		if (!pluginDir) {
			throw new Error(
				'Could not resolve plugin directory. Cache directory cannot be set.',
			);
		}

		this.cacheDir = `${pluginDir}/cache`;
	}

	async resolvePluginDir(): Promise<string | undefined> {
		if (this.manifest.dir) {
			return this.manifest.dir;
		}

		const expected = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;

		if (await this.isOurPluginDir(expected)) {
			return expected;
		}

		return await this.findPluginDir();
	}

	private async isOurPluginDir(dir: string): Promise<boolean> {
		try {
			const raw = await this.app.vault.adapter.read(
				`${dir}/manifest.json`,
			);

			const manifest = JSON.parse(raw);

			return manifest.id === this.manifest.id;
		} catch {
			return false;
		}
	}

	private async findPluginDir(): Promise<string | undefined> {
		const pluginsDir = `${this.app.vault.configDir}/plugins`;
		const { folders } = await this.app.vault.adapter.list(pluginsDir);

		for (const folder of folders) {
			if (await this.isOurPluginDir(folder)) {
				return folder;
			}
		}

		return undefined;
	}
}
