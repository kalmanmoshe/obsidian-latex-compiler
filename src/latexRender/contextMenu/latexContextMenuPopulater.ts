import { Menu, Notice, TFile, Platform } from 'obsidian';
import LatexCompilerPlugin from 'src/main';
import { LogDisplayModal } from '../logs/logDisplayModal';
import { LatexTask } from '../task/latexTask';
import {
	findTaskSectionInfoFromHashInFile,
	TaskSectionInformation,
} from '../resolvers/taskSectionInformation';
import { codeBlockToContent } from 'obsidian-dev-utils';
import ResultFileCache, { splitCacheId } from '../cache/resultFileCache';
import { LATEX_RENDER_ID_KEY } from '../pdfConversion/pdfToSVG';
import { ResultFileFormat, CompilePipeline } from 'src/settings/settings';
import { LatexRenderChild } from '../task/latexRenderChild';

type RequireFunction = {
	(moduleName: 'child_process'): {
		exec(this: void, command: string): void;
	};
};

type WindowWithRequire = Window & {
	require: RequireFunction;
};

async function revealFileWithFocus(path: string) {
	if (!Platform.isDesktopApp) {
		new Notice('Reveal in file explorer is only available on desktop.');
		return;
	}

	const childProcess = (activeWindow as WindowWithRequire).require('child_process');

	if (Platform.isWin) {
		const winPath = path.replace(/\//g, '\\');
		childProcess.exec(`start "" explorer.exe /select,"${winPath}"`);
	} else if (Platform.isMacOS) {
		const script = `
			tell application "Finder"
				reveal POSIX file "${path}"
				activate
			end tell
		`;
		childProcess.exec(`osascript -e '${script.replace(/\n/g, '')}'`);
	} else {
		const { shell } = await import('electron');
		shell.showItemInFolder(path);
	}
}

type RenderOutput =
	| {
		type: 'svg';
		element: SVGElement;
	}
	| {
		type: 'pdf';
		element: HTMLObjectElement;
	}
	| {
		type: 'error';
		element: HTMLElement;
	};

/**add:
 * - show logs (soch as \print{} \message{"hello world"} and more)
 * - properties (such as size, dependencies, hash, date created, )
 */
export class LatexContextMenuPopulater {

	private readonly plugin: LatexCompilerPlugin;
	private readonly menu: Menu;
	private readonly sourcePath: string;
	private readonly resultFileCache: ResultFileCache;

	/**
	 * The parent el of the code block
	 */
	private readonly blockEl: HTMLElement;
	private readonly renderChild: LatexRenderChild;
	private readonly output: RenderOutput;
	private readonly compilePipeline: CompilePipeline;

	private sourceAssignmentPromise: Promise<boolean> | null = null;

	private content!: string;
	private stem!: string;
	private rawHash!: string;

	constructor(
		plugin: LatexCompilerPlugin,
		menu: Menu,
		renderChild: LatexRenderChild,
		sourcePath: string,
		compilePipeline: CompilePipeline,
	) {
		this.plugin = plugin;
		this.menu = menu;
		this.sourcePath = sourcePath;
		this.renderChild = renderChild;
		this.compilePipeline = compilePipeline;
		this.resultFileCache = this.plugin.latexRenderer.cache.resultFileCache;

		this.blockEl = findLatexContainer(this.renderChild.containerEl);
		// A loader has no context-menu items.
		if (this.checkIsLoader()) {
			return;
		}

		this.output = this.findOutput();
		this.assignStem();

		this.addCommonItems();
		this.addFormatSpecificItems();
		if (!__PRODUCTION__) {
			this.addDebugDisplayItems();
		}
	}

	private findOutput(): RenderOutput {
		//Important: the order of these checks matters. PDF must be checked before SVG, because the PDF is rendered with a container that contains an SVG.
		const pdf = this.blockEl.querySelector<HTMLObjectElement>(
			'object.latex-pdf-object',
		);

		if (pdf) {
			return {
				type: 'pdf',
				element: pdf,
			};
		}

		const svg = this.blockEl.querySelector<SVGElement>('svg');

		if (svg) {
			return {
				type: 'svg',
				element: svg,
			};
		}

		const error = this.blockEl.querySelector<HTMLElement>(
			`.latex-compiler-error-container`,
		);

		if (error) {
			return {
				type: 'error',
				element: error,
			};
		}

		throw new Error('No LaTeX output element found');
	}


	private checkIsLoader(): boolean {
		return findChildEl(this.blockEl, isLoader) !== undefined
	}

	private assignStem(): void {
		const stem = this.output.element.getAttribute(LATEX_RENDER_ID_KEY);

		if (!stem) {
			console.error(
				'No stem found for rendered LaTeX output',
				this.output,
			);

			throw new Error('No stem found for rendered LaTeX output');
		}

		this.stem = stem;
		this.rawHash = splitCacheId(this.stem).rawHash;
	}

	private addCommonItems(): void {
		this.addItem('remove & re-render', 'trash', async () => await this.removeAndReRender(), {
			hiddenOnIos: true,
		});

		this.addItem(
			'Show logs',
			'info',
			async () => {
				void this.showLogs();
			},
			{ hiddenOnIos: true },
		);

		this.addItem(
			'Save render as attachment',
			'file-plus',
			async () => {
				await this.saveRenderAsAttachment();
			},
			{ hiddenOnError: true },
		);

		this.addItem(
			'Reveal in file explorer',
			'folder',
			async () => {
				this.revealFileInExplorer();
			},
			{ hiddenOnError: true, hiddenOnMobile: true },
		);
	}

	private addFormatSpecificItems(): void {
		switch (this.output.type) {
			case 'svg':
				this.addSvgItems(this.output.element);
				break;

			case 'pdf':
				//placeholder for future pdf context menu items
				//this.addPdfItems(this.output.element);
				break;

			case 'error':
				break;
		}
	}

	private addSvgItems(svg: SVGElement): void {
		this.addItem(
			'Copy SVG',
			'copy',
			async () => {
				if (svg) {
					const svgString = new XMLSerializer().serializeToString(svg);
					await navigator.clipboard.writeText(svgString);
				}
			},
			{ hiddenOnError: true },
		);
	}

	// place holder for when i get around to adding pdf context menu items
	// private addPdfItems(pdfObject: HTMLObjectElement): void {}

	private addDebugDisplayItems() {
		this.addItem('Copy parsed source', 'copy', async () => {
			const source = (await this.getProcessedTask())?.getProcessedContent();
			if (!source) return;
			await navigator.clipboard.writeText(source);
		});
	}

	private addItem(
		title: string,
		icon: string,
		onClick: () => void | Promise<void>,
		options?: {
			hiddenOnError?: boolean;
			hiddenOnMobile?: boolean;
			hiddenOnIos?: boolean
		},
	) {
		if (options?.hiddenOnError && this.isError) return;
		if (options?.hiddenOnMobile && Platform.isMobile) return;
		if (options?.hiddenOnIos && !this.plugin.latexRenderer.isNotIos()) return;

		this.menu.addItem((item) => {
			item.setTitle(title);
			item.setIcon(icon);
			item.onClick(onClick);
		});
	}

	private async saveRenderAsAttachment() {
		if (this.isError) return;

		const format: ResultFileFormat =
			this.output.type === 'svg' ? 'svg' : 'pdf';

		const resultFile = await this.resultFileCache.getResultFile(
			this.rawHash,
			this.sourcePath,
			this.compilePipeline,
			format
		);

		if (resultFile === undefined) {
			new Notice('Rendered file is no longer available.');
			return;
		}

		const fileName = `latex-render.${format}`;

		const attachmentPath =
			await this.plugin.app.fileManager.getAvailablePathForAttachment(
				fileName,
				this.sourcePath,
			);

		if (typeof resultFile.data === 'string') {
			await this.plugin.app.vault.create(
				attachmentPath,
				resultFile.data,
			);
		} else {
			await this.plugin.app.vault.createBinary(
				attachmentPath,
				resultFile.data.buffer.slice(
					resultFile.data.byteOffset,
					resultFile.data.byteOffset + resultFile.data.byteLength,
				) as ArrayBuffer,
			);
		}
		const embed = `![[${attachmentPath}]]`;
		await navigator.clipboard.writeText(embed);

		new Notice(`Saved render to ${attachmentPath} and copied embed to clipboard.`);
	}

	private revealFileInExplorer() {
		if (this.isError) {
			throw new Error("Can't reveal file in explorer, this is an error display. no file to reveal.");
		}
		try {
			if (!this.resultFileCache.isPhysicalCache()) {
				new Notice("Result file cache is not physical, can't open file in explorer.");
				return;
			}
			if (!this.resultFileCache.hasRawHash(this.rawHash)) {
				new Notice("File not found in cache, can't open file in explorer.");
				return;
			}
			let format: ResultFileFormat = this.output.type === 'svg' ? 'svg' : 'pdf';
			const filePath = this.resultFileCache.getAbsolutePathFromStem(this.stem, format);
			void revealFileWithFocus(filePath);
		} catch (err) {
			console.error('Failed to open file in explorer:', err);
		}
	}

	private async showLogs() {
		void this.assignLatexContent();
		let logInfo = this.plugin.latexRenderer.cache.getLog(this.stem);
		if (!logInfo) {
			await this.assignLatexContent();
			logInfo = await this.plugin.latexRenderer.cache.forceGetLog(this.stem, {
				source: this.content,
				sourcePath: this.sourcePath,
			});
		}
		const modal = new LogDisplayModal(logInfo, this.plugin.app);
		modal.open();
	}

	assignLatexContent(): Promise<boolean> {
		if (this.content !== undefined) return Promise.resolve(true);
		if (!this.sourceAssignmentPromise) {
			this.sourceAssignmentPromise = (async () => {
				const info = await this.getSectionInfo();
				this.content = codeBlockToContent(info.codeBlock);
				return true;
			})();
		}
		return this.sourceAssignmentPromise;
	}

	private async getFile() {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!file) throw new Error('File not found');
		if (!(file instanceof TFile)) throw new Error('File is not a TFile');
		return file;
	}

	async getTask(): Promise<LatexTask> {
		await this.assignLatexContent();
		const file = await this.getFile();
		const sectionInfos = await findTaskSectionInfoFromHashInFile(file, this.rawHash, this.plugin.app);
		if (!sectionInfos)
			throw new Error(
				'No section info found for hash: ' + this.rawHash + ' in file: ' + file.path,
			);
		const task = LatexTask.fromSectionInfos(
			this.plugin,
			this.sourcePath,
			sectionInfos,
			this.renderChild,
		);
		return task;
	}

	async getSectionInfo(): Promise<TaskSectionInformation> {
		const file = await this.getFile();
		const sectionInfos = await findTaskSectionInfoFromHashInFile(file, this.rawHash, this.plugin.app);
		if (!sectionInfos)
			throw new Error(
				'No section info found for hash: ' + this.rawHash + ' in file: ' + file.path,
			);
		const sectionInfo = sectionInfos[0];
		this.content = codeBlockToContent(sectionInfo.codeBlock);
		return sectionInfo;
	}

	/**
	 * Cleans the block element by removing all its children.
	 */
	private cleanBlockEl() {
		while (this.blockEl.firstChild) {
			this.blockEl.removeChild(this.blockEl.firstChild);
		}
	}
	/**
	 * Can't be saved as contains dynamic content.
	 */
	private async removeAndReRender() {
		if (!this.isError) {
			const success = await this.resultFileCache.removeResultFileFromCache(
				this.rawHash,
				this.sourcePath,
				this.compilePipeline,
				this.output.type as ResultFileFormat
			);
			if (!success) {
				console.error('Failed to remove result file from cache:', this.stem);
			}
		}
		this.cleanBlockEl();
		const task = await this.getTask();
		this.plugin.latexRenderer.queue!.push(task);
		new Notice('SVG removed from cache. Re-rendering...');
	}

	private async getProcessedTask(): Promise<LatexTask | undefined> {
		const task = await this.getTask();
		try {
			await task.process();
		} catch (err) {
			new Notice('Failed to process task');
			console.error('Failed to process task:', err);
			return undefined;
		}
		return task;
	}

	private get isError(): boolean {
		return this.output.type === 'error';
	}
}

function findLatexContainer(el: HTMLElement): HTMLElement {
	const container = climbToEl(el, isRenderContainer) ?? findChildEl(el, isRenderContainer);

	if (!container) {
		throw new Error('No SVG container found');
	}

	return container;
}

function climbToEl(el: HTMLElement, predicate: (el: HTMLElement) => boolean): HTMLElement | undefined {
	let current: HTMLElement | null = el;

	while (current) {
		if (predicate(current)) {
			return current;
		}

		const childContainer = findChildEl(current, isRenderContainer);
		if (childContainer) {
			return childContainer;
		}

		current = current.parentElement;
	}

	return undefined;
}

function findChildEl(el: HTMLElement, predicate: (el: HTMLElement) => boolean): HTMLElement | undefined {
	return Array.from(el.children).find(
		(child): child is HTMLElement => child.instanceOf(HTMLElement) && predicate(child),
	);
}

function isRenderContainer(el: HTMLElement) {
	return el.classList.contains('latex-compiler-render');
}

function isLoader(el: HTMLElement) {
	return el.classList.contains('latex-compiler-loader-parent-container');
}
