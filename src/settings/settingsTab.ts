import { Notice, PluginSettingTab, Setting, setIcon, AbstractInputSuggest, debounce, TAbstractFile, Vault } from 'obsidian';
import { CompilerType, DEFAULT_SETTINGS, OverflowStrategy, shouldEnableCompilerByDefault } from './settings';
import LatexCompilerPlugin from '../main';

const FILE_SEARCH_DEBOUNCE_MS = 2000;


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

  selectSuggestion(
    file: TAbstractFile,
    _: MouseEvent | KeyboardEvent,
  ): void {
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.displayGraphSettings();
		this.displayCachedSettings();
		this.displayPreambleSettings();
		this.displayExperimentalSettings();
	}

	private displayGraphSettings() {
		const containerEl = this.containerEl;
		this.addHeading(containerEl, 'graph', 'ballpen');

		new Setting(containerEl)
			.setName('Adapt SVG colors to theme')
			.setDesc(
				'Adjust black and white SVG colors to match the current Obsidian theme, keeping diagrams visible in both light and dark mode.'
			)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.adaptSVGColorsToTheme)
				.onChange(async value => {
					this.plugin.settings.adaptSVGColorsToTheme = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('SVG render sizing')
			.setDesc('Choose how SVG renders are sized when displayed in the note.')
			.addDropdown(dropdown => dropdown
				.addOptions({
					fit: 'Fit to note width',
					downscale: 'Preserve size, shrink if needed',
					scroll: 'Preserve size and scroll',
					hidden: 'Preserve size and clip',
				})
				.setValue(this.plugin.settings.overflowStrategy)
				.onChange(async value => {
					this.plugin.settings.overflowStrategy = value as OverflowStrategy;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Compiler')
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Choose the LaTeX compiler for rendering diagrams. \"PdfTeX\" is the classic engine, while \"XeTeX\" offers better Unicode and modern font support. Changing this may affect compatibility and output."
			)
			.addDropdown(dropdown => dropdown
				.addOptions({
					[CompilerType.PdfTeX]: 'PdfTeX',
					[CompilerType.XeTeX]: 'XeTeX',
				})
				.setValue(this.plugin.settings.compiler)
				.onChange(async value => {
					this.plugin.settings.compiler = value as CompilerType;
					await this.plugin.saveSettings();
					await this.plugin.latexRenderer.switchCompiler();
				})
			);
	}

	
	private displayCachedSettings() {
		const { containerEl } = this;

		this.addHeading(containerEl, 'cache', 'database');

		new Setting(containerEl)
			.setName('Physical cache enabled')
			.setDesc(
				'Whether to use a physical cache for rendered diagrams. If enabled, rendered diagrams are stored on disk, improving performance for subsequent loads. When disabled, diagrams are cached in memory only, which may lead to slower performance on startup but reduces disk usage.'
			)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.physicalCache)
				.onChange(async value => {
					this.plugin.settings.physicalCache = value;
					await this.plugin.saveSettings();
					await this.plugin.latexRenderer.cache.resultFileCache.togglePhysicalCache();

					physicalCacheLocationSetting.settingEl.toggleClass('hidden', !value);
				})
			);

		const physicalCacheLocationSetting = new Setting(containerEl)
			.setName('Physical cache location')
			.setDesc(
				'The directory where rendered diagrams are stored. Empty for default, "/" for the vault root, or a specific path.'
			)
			.addSearch(search => {
				search
					.setPlaceholder(DEFAULT_SETTINGS.physicalCacheLocation)
					.setValue(this.plugin.settings.physicalCacheLocation)
					.onChange(
						debounce(async value => {
							this.plugin.settings.physicalCacheLocation = value;
							await this.plugin.saveSettings();
							await this.plugin.latexRenderer.cache.resultFileCache.changeCacheDirectory();
						}, FILE_SEARCH_DEBOUNCE_MS, true)
					);

				new FileSuggest(this.plugin.app, search.inputEl);
			});

		physicalCacheLocationSetting.settingEl.toggleClass(
			'hidden',
			!this.plugin.settings.physicalCache
		);

		new Setting(containerEl)
			.setName('Clear cached result files')
			.setDesc(
				"Result files (PDF, SVG) rendered with the plugin are cached, so LaTeX don't have to be re-rendered from scratch every time you open a page. Use this to clear the cache and force all LaTeX to be re-rendered."
			)
			.addButton(button => button
				.setButtonText('Clear cached result files')
				.setIcon('trash')
				.setTooltip('Clear cached result files')
				.onClick(async () => {
					await this.plugin.latexRenderer.cache.resultFileCache.removeAllCached();
					new Notice('Cleared cached svgs');
				})
			);
	}

	private displayPreambleSettings() {
		const { containerEl } = this;

		this.addHeading(containerEl, 'Preamble', 'pencil');

		const descriptionFragment = activeDocument.createDocumentFragment();
		const descriptionDetails = activeDocument.createElement('span');

		descriptionDetails.textContent =
			"When enabled, code blocks with a header specifying a name (e.g., 'name: someAwesomeCode') " +
			'can be included directly in your LaTeX code using commands like \\include{}. ' +
			'The name provided in the header identifies the code block as a virtual file. ' +
			'If disabled, this functionality is unavailable. ' +
			"Note: the default file extension is '.tex', unless explicitly specified.";

		descriptionFragment.appendChild(descriptionDetails);

		new Setting(containerEl)
			.setName('Virtual files from code blocks')
			.setDesc(descriptionFragment)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.virtualFilesFromCodeBlocks)
				.onChange(async value => {
					this.plugin.settings.virtualFilesFromCodeBlocks = value;
					await this.plugin.saveSettings();
				})
			);
	}

	
	private displayExperimentalSettings() {
		const { containerEl } = this;

		this.addHeading(containerEl, 'Experimental', 'flask-conical');

		const warning = activeDocument.createDocumentFragment();
		const warningText = activeDocument.createElement('div');

		warningText.textContent =
			'Warning: these features use experimental LaTeX source preprocessing and may alter or reinterpret the structure of your input. ' +
			'They are not considered stable and may cause unexpected compilation behavior with some LaTeX documents. ' +
			'If you encounter problems, disable experimental preprocessing before reporting an issue.';

		warning.appendChild(warningText);

		new Setting(containerEl)
			.setName('Experimental features')
			.setDesc(warning);

		new Setting(containerEl)
			.setName('Enable experimental smart preprocessing')
			.setDesc(
				'Enables advanced document-structure processing and automatic inclusion of configured virtual files. ' +
				'When disabled, TikZ code blocks use the minimal TikZJax-compatible preprocessing path.'
			)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.experimentalSmartPreprocessing)
				.onChange(async value => {
					this.plugin.settings.experimentalSmartPreprocessing = value;
					await this.plugin.saveSettings();

					autoloadedFilesSetting.settingEl.toggleClass('hidden', !value);
				})
			);

		const autoloadedFilesSetting = new Setting(containerEl)
			.setName('Autoloaded virtual files')
			.setDesc(
				'Specify a file or folder containing virtual files to automatically include in every LaTeX render.'
			)
			.addSearch(search => {
				search
					.setPlaceholder(DEFAULT_SETTINGS.autoloadedVfsFilesDir)
					.setValue(this.plugin.settings.autoloadedVfsFilesDir)
					.onChange(
						debounce(async value => {
							this.plugin.settings.autoloadedVfsFilesDir = value;
							await this.plugin.saveSettings(true);
						}, FILE_SEARCH_DEBOUNCE_MS, true)
					);

				new FileSuggest(this.plugin.app, search.inputEl);
			});

		autoloadedFilesSetting.settingEl.toggleClass(
			'hidden',
			!this.plugin.settings.experimentalSmartPreprocessing
		);

		const localSettings = this.plugin.getLocalStorageSettings();

		const description = !shouldEnableCompilerByDefault()
			? 'The compiler is disabled by default on this device because compilation may cause severe performance issues or instability. ' +
			'Enable this only if you understand the risk. This setting affects this device only.'
			: 'Controls whether the LaTeX compiler runs on this specific device. ' +
			'Disable it on older or low-powered devices if compilation causes significant slowdowns. ' +
			'This setting affects this device only.';

		new Setting(containerEl)
			.setName('Enable compiler on this device')
			.setDesc(description)
			.addToggle(toggle => toggle
				.setValue(localSettings.enableCompilerOnThisDevice)
				.onChange(async value => {
					this.plugin.saveLocalStorageSetting(
						'enableCompilerOnThisDevice',
						value
					);
					await this.plugin.latexRenderer.syncCompilerState();
				})
			);
	}

}
