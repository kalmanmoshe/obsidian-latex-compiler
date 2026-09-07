import { Plugin, Notice } from 'obsidian';
import { LatexCompilerPluginSettings, DEFAULT_SETTINGS } from './settings/settings';
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

	async onload() {
		const startTime = performance.now();
		console.log('Loading Latex Compiler plugin');
		this.menuDecider = new LatexContextMenuDecider(this);

		await this.loadSettings();

		this.addEditorCommands();
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

	private watchFiles() {
		this.registerEvent(this.app.vault.on("rename", () => this.latexRenderer.preprocessor.refresh(false, true)));
		this.registerEvent(this.app.vault.on("delete", (file) => onFileDelete(this, file)));
		this.registerEvent(this.app.vault.on("create", (file) => onFileCreate(this, file)));
	}

	getDefaultCacheDir(): string {
		return `${this.app.vault.configDir}/plugins/${this.manifest.id}/cache`;
	}
}
