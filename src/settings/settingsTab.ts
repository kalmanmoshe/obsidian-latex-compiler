import {
	Notice,
	PluginSettingTab,
	Setting,
	requireApiVersion,
	setIcon,
	AbstractInputSuggest,
	debounce,
	TAbstractFile,
	Vault,
	SettingDefinitionEmpty,
	SettingDefinitionRender,
	SettingDefinitionItem,
} from 'obsidian';
import {
	CompilerType,
	DEFAULT_SETTINGS,
	OverflowStrategy,
	shouldEnableCompilerByDefault,
} from './settings';
import LatexCompilerPlugin from '../main';

const FILE_SEARCH_DEBOUNCE_MS = 2000;

type SettingRow =
	| SettingDefinitionEmpty
	| (Omit<SettingDefinitionRender, 'render'> & {
			render: (setting: Setting) => void;
	  });

export class FileSuggest extends AbstractInputSuggest<TAbstractFile> {
	protected getSuggestions(query: string): TAbstractFile[] {
		const files: TAbstractFile[] = [];
		const lowerQuery = query.toLowerCase();

		Vault.recurseChildren(this.app.vault.getRoot(), (file) => {
			if (file.path.toLowerCase().includes(lowerQuery)) {
				files.push(file);
			}
		});

		return files;
	}

	renderSuggestion(file: TAbstractFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TAbstractFile, _: MouseEvent | KeyboardEvent): void {
		this.setValue(file.path);
		this.close();
	}
}

export class LatexCompilerSettingTab extends PluginSettingTab {
	plugin: LatexCompilerPlugin;

	constructor(plugin: LatexCompilerPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	addHeading(containerEl: HTMLElement, name: string, icon: string) {
		const heading = new Setting(containerEl).setName(name).setHeading();
		const parentEl = heading.settingEl;
		const iconEl = parentEl.createDiv();
		setIcon(iconEl, icon);
		iconEl.addClass('latex-compiler-math-settings-icon');
		parentEl.prepend(iconEl);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ type: 'group', heading: 'Graph', items: this.displayGraphSettings() },
			{ type: 'group', heading: 'Cache', items: this.displayCachedSettings() },
			{ type: 'group', heading: 'Preamble', items: this.displayPreambleSettings() },
			{ type: 'group', heading: 'Experimental', items: this.displayExperimentalSettings() },
		];
	}

	private refreshSettings(): void {
		if (requireApiVersion('1.13.0')) {
			this.update();
		} else {
			this.renderLegacySettings();
		}
	}

	// Obsidian versions before 1.13 use the same definitions through this renderer.
	display(): void {
		this.renderLegacySettings();
	}

	private renderLegacySettings(): void {
		this.containerEl.empty();
		const sections = [
			{ name: 'Graph', icon: 'ballpen', items: this.displayGraphSettings() },
			{ name: 'Cache', icon: 'database', items: this.displayCachedSettings() },
			{ name: 'Preamble', icon: 'pencil', items: this.displayPreambleSettings() },
			{
				name: 'Experimental',
				icon: 'flask-conical',
				items: this.displayExperimentalSettings(),
			},
		];
		for (const section of sections) {
			this.addHeading(this.containerEl, section.name, section.icon);
			for (const definition of section.items) {
				if (
					definition.visible === false ||
					(typeof definition.visible === 'function' && !definition.visible())
				)
					continue;
				const setting = new Setting(this.containerEl).setName(definition.name);
				if (definition.desc) setting.setDesc(definition.desc);
				if (definition.render) definition.render(setting);
			}
		}
	}

	private displayGraphSettings(): SettingRow[] {
		return [
			{
				name: 'Adapt SVG colors to theme',
				desc: 'Adjust black and white SVG colors to match the current Obsidian theme, keeping diagrams visible in both light and dark mode.',
				render: (setting) => {
					setting.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings.adaptSVGColorsToTheme)
							.onChange(async (value) => {
								this.plugin.settings.adaptSVGColorsToTheme = value;
								await this.plugin.saveSettings();
							}),
					);
				},
			},
			{
				name: 'SVG render sizing',
				desc: 'Choose how SVG renders are sized when displayed in the note.',
				render: (setting) => {
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions({
								fit: 'Fit to note width',
								downscale: 'Preserve size, shrink if needed',
								scroll: 'Preserve size and scroll',
								hidden: 'Preserve size and clip',
							})
							.setValue(this.plugin.settings.overflowStrategy)
							.onChange(async (value) => {
								this.plugin.settings.overflowStrategy = value as OverflowStrategy;
								await this.plugin.saveSettings();
							}),
					);
				},
			},
			{
				name: 'Compiler',
				desc:
					'Choose the LaTeX compiler for rendering diagrams. ' +
					'"PdfTeX"' +
					' is the classic engine, while ' +
					'"XeTeX"' +
					' offers better Unicode and modern font support. Changing this may affect compatibility and output.',
				render: (setting) => {
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions({
								[CompilerType.PdfTeX]: 'PdfTeX',
								[CompilerType.XeTeX]: 'XeTeX',
							})
							.setValue(this.plugin.settings.compiler)
							.onChange(async (value) => {
								this.plugin.settings.compiler = value as CompilerType;
								await this.plugin.saveSettings();
								await this.plugin.latexRenderer.switchCompiler();
							}),
					);
				},
			},
		];
	}

	private displayCachedSettings(): SettingRow[] {
		return [
			{
				name: 'Physical cache enabled',
				desc: 'Whether to use a physical cache for rendered diagrams. If enabled, rendered diagrams are stored on disk, improving performance for subsequent loads. When disabled, diagrams are cached in memory only, which may lead to slower performance on startup but reduces disk usage.',
				render: (setting) => {
					setting.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings.physicalCache)
							.onChange(async (value) => {
								this.plugin.settings.physicalCache = value;
								await this.plugin.saveSettings();
								await this.plugin.latexRenderer.cache.resultFileCache.togglePhysicalCache();
								this.refreshSettings();
							}),
					);
				},
			},
			{
				name: 'Physical cache location',
				desc: 'The directory where rendered diagrams are stored. Empty for default, "/" for the vault root, or a specific path.',
				visible: () => this.plugin.settings.physicalCache,
				render: (setting) => {
					setting.addSearch((search) => {
						search
							.setPlaceholder(DEFAULT_SETTINGS.physicalCacheLocation)
							.setValue(this.plugin.settings.physicalCacheLocation)
							.onChange(
								debounce(
									async (value) => {
										this.plugin.settings.physicalCacheLocation = value;
										await this.plugin.saveSettings();
										await this.plugin.latexRenderer.cache.resultFileCache.changeCacheDirectory();
									},
									FILE_SEARCH_DEBOUNCE_MS,
									true,
								),
							);

						new FileSuggest(this.plugin.app, search.inputEl);
					});
				},
			},
			{
				name: 'Clear cached result files',
				desc: "Result files (PDF, SVG) rendered with the plugin are cached, so LaTeX don't have to be re-rendered from scratch every time you open a page. Use this to clear the cache and force all LaTeX to be re-rendered.",
				render: (setting) => {
					setting.addButton((button) =>
						button
							.setButtonText('Clear cached result files')
							.setIcon('trash')
							.setTooltip('Clear cached result files')
							.onClick(async () => {
								await this.plugin.latexRenderer.cache.resultFileCache.removeAllCached();
								new Notice('Cleared cached svgs');
							}),
					);
				},
			},
		];
	}

	private displayPreambleSettings(): SettingRow[] {
		const descriptionFragment = createFragment();
		const descriptionDetails = descriptionFragment.createSpan();
		descriptionDetails.textContent =
			"When enabled, code blocks with a header specifying a name (e.g., 'name: someAwesomeCode') " +
			'can be included directly in your LaTeX code using commands like \\include{}. ' +
			'The name provided in the header identifies the code block as a virtual file. ' +
			'If disabled, this functionality is unavailable. ' +
			"Note: the default file extension is '.tex', unless explicitly specified.";
		descriptionFragment.appendChild(descriptionDetails);
		return [
			{
				name: 'Virtual files from code blocks',
				desc: descriptionFragment,
				render: (setting) => {
					setting.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings.virtualFilesFromCodeBlocks)
							.onChange(async (value) => {
								this.plugin.settings.virtualFilesFromCodeBlocks = value;
								await this.plugin.saveSettings();
							}),
					);
				},
			},
		];
	}

	private displayExperimentalSettings(): SettingRow[] {
		const warning = createFragment();
		const warningText = warning.createDiv();
		warningText.textContent =
			'Warning: these features use experimental LaTeX source preprocessing and may alter or reinterpret the structure of your input. ' +
			'They are not considered stable and may cause unexpected compilation behavior with some LaTeX documents. ' +
			'If you encounter problems, disable experimental preprocessing before reporting an issue.';
			
		warning.appendChild(warningText);

		const description = !shouldEnableCompilerByDefault()
			? 'The compiler is disabled by default on this device because compilation may cause severe performance issues or instability. ' +
				'Enable this only if you understand the risk. This setting affects this device only.'
			: 'Controls whether the LaTeX compiler runs on this specific device. ' +
				'Disable it on older or low-powered devices if compilation causes significant slowdowns. ' +
				'This setting affects this device only.';

		return [
			{ name: 'Experimental features', desc: warning },
			{
				name: 'Enable experimental smart preprocessing',
				desc:
					'Enables advanced document-structure processing and automatic inclusion of configured virtual files. ' +
					'When disabled, TikZ code blocks use the minimal TikZJax-compatible preprocessing path.',
				render: (setting) => {
					setting.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings.experimentalSmartPreprocessing)
							.onChange(async (value) => {
								this.plugin.settings.experimentalSmartPreprocessing = value;
								await this.plugin.saveSettings();
								this.refreshSettings();
							}),
					);
				},
			},
			{
				name: 'Autoloaded virtual files',
				desc: 'Specify a file or folder containing virtual files to automatically include in every LaTeX render.',
				visible: () => this.plugin.settings.experimentalSmartPreprocessing,
				render: (setting) => {
					setting.addSearch((search) => {
						search
							.setPlaceholder(DEFAULT_SETTINGS.autoloadedVfsFilesDir)
							.setValue(this.plugin.settings.autoloadedVfsFilesDir)
							.onChange(
								debounce(
									async (value) => {
										this.plugin.settings.autoloadedVfsFilesDir = value;
										await this.plugin.saveSettings(true);
									},
									FILE_SEARCH_DEBOUNCE_MS,
									true,
								),
							);

						new FileSuggest(this.plugin.app, search.inputEl);
					});
				},
			},
			{
				name: 'Enable compiler on this device',
				desc: description,
				render: (setting) => {
					const localSettings = this.plugin.getLocalStorageSettings();
					setting.addToggle((toggle) =>
						toggle
							.setValue(localSettings.enableCompilerOnThisDevice)
							.onChange(async (value) => {
								this.plugin.saveLocalStorageSetting(
									'enableCompilerOnThisDevice',
									value,
								);
								await this.plugin.latexRenderer.syncCompilerState();
							}),
					);
				},
			},
		];
	}
}
