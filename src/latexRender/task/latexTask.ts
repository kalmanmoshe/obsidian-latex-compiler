import LatexCompilerPlugin from 'src/main';
import {
	App,
	MarkdownPostProcessorContext,
	MarkdownSectionInformation,
	MarkdownView,
	TFile,
} from 'obsidian';
import { codeBlockToContent, extractCodeBlockMetadata, extractCodeBlockName } from '../resolvers/latexSourceFromFile';
import { findMatchingCodeBlockSections } from '../resolvers/findSection';
import { TaskSectionInformation } from '../resolvers/taskSectionInformation';
import { sectionToTaskSectionInfo, taskSectionInfoToContent } from '../resolvers/sectionUtils';
import { hashLatexContent } from '../cache/compilerCache';
import { CompilePipeline, ResultFileFormat, SOURCE_REVERIFICATION_TIME_MS } from 'src/settings/settings';
import { LatexRenderChild } from './latexRenderChild';
import { getLatexCodeBlockDefinition, LatexCodeBlockDefinition, LatexCodeBlockLanguage } from '../codeBlockTypes';
import { getCacheId } from '../cache/resultFileCache';

/**
 * sets the section information for the task.
 * Attempts to locate the Markdown section that corresponds to a rendered code block,
 * even when section info is unavailable (e.g., virtual rendering or nested codeBlock environments).
 * @param ctx
 * @returns
 */
async function mdSecInfosFromMdPostProcessorCtx(
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	content: string,
	app: App
) {
	const sectionFromContext = ctx.getSectionInfo(el);
	if (sectionFromContext) {
		return [sectionFromContext];
	}

	let sectionInfos = await findMatchingCodeBlockSections(ctx.sourcePath, content, app);

	if (!sectionInfos || sectionInfos.length === 0) {
		throw new Error(
			'No section information found for the task. This might be due to virtual rendering or nested codeBlock environments.',
		);
	}
	return sectionInfos;
}

export function getEditorTextForPath(path: string, app: App): string | undefined {
	const leaves = app.workspace.getLeavesOfType('markdown');

	for (const leaf of leaves) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) continue;

		if (view.file?.path === path) {
			return view.editor.getValue();
		}
	}

	return undefined;
}

// Lower numbers run first: 0 for export, 1 for regular rendering
export enum LatexTaskPriority {
	Regular = 1,
	Export = 0,
}

export class LatexTask {
	protected readonly plugin: LatexCompilerPlugin;
	protected readonly content: string;
	readonly sourcePath: string;
	readonly codeBlockLanguage: LatexCodeBlockLanguage;
	readonly definition: LatexCodeBlockDefinition;
	readonly rawHash: string;
	/**
	 * The resolved hash is the hash of the content after it has been processed and the dependencies have been resolved.
	 */
	protected resolvedHash: string;
	protected blockId: string;
	readonly el: HTMLElement;
	renderChild?: LatexRenderChild;
	protected sectionInfos: TaskSectionInformation[];
	private lastSectionInfoVerificationTime: number = Date.now();

	/**
	 * Because we can't guarantee one section information per task, there may be situations where there are multiple. we don't have enough information to prefer one over the other, so we must consider them all.
	 */
	private possibleNames: string[];
	processed: boolean = false;
	private processedContent: string;

	constructor(
		plugin: LatexCompilerPlugin,
		codeBlockLanguage: LatexCodeBlockLanguage,
		definition: LatexCodeBlockDefinition,
		source: string,
		el: HTMLElement,
		rendererChild: LatexRenderChild | undefined,
		sourcePath: string,
		sectionInfos: TaskSectionInformation[],
	) {
		this.plugin = plugin;
		this.codeBlockLanguage = codeBlockLanguage;
		this.definition = definition;
		this.content = source;
		this.rawHash = hashLatexContent(source);
		this.el = el;
		this.renderChild = rendererChild;
		this.sourcePath = sourcePath;
		this.setSectionInfos(sectionInfos);
	}

	get compilePipeline(): CompilePipeline { return this.definition.compilePipeline; }
	get resultFormat(): ResultFileFormat { return this.definition.resultFormat!; }

	hasSourceChangeTimeExceededMargin() {
		return (
			Date.now() - this.lastSectionInfoVerificationTime >
			SOURCE_REVERIFICATION_TIME_MS
		);
	}

	/**
	 * Ensures the code block still exists for this task.
	 * Returns true if the source is still present or could be re-resolved, false otherwise.
	 */
	async verifySource(): Promise<boolean> {
		const returnVerify = (value: boolean) => {
			this.lastSectionInfoVerificationTime = Date.now();
			return value;
		};
		this.lastSectionInfoVerificationTime = Date.now();
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!file || !(file instanceof TFile)) return returnVerify(false);

		// First pass: use cached text (fast)
		const fileText = await this.plugin.app.vault.cachedRead(file);
		const lines = fileText.split('\n');
		const verifiedSectionInfos: TaskSectionInformation[] = [];

		for (const sectionInfo of this.sectionInfos) {
			if (sectionInfo.lineEnd < lines.length) {
				const sectionContent = taskSectionInfoToContent(lines, sectionInfo);
				if (sectionContent === this.content) {
					verifiedSectionInfos.push(sectionInfo);
				}
			}
		}

		if (verifiedSectionInfos.length === this.sectionInfos.length) {
			return returnVerify(true);
		}

		return returnVerify(await this.rebuildTaskFromContent());
	}

	/**
	 * Rebuilds the task from the content.
	 * @returns {boolean} - Returns true if the task was successfully rebuilt, false otherwise.
	 */
	async rebuildTaskFromContent(): Promise<boolean> {
		const verifiedSectionInfos: TaskSectionInformation[] = [];

		const sectionInfos = await findMatchingCodeBlockSections(this.sourcePath, this.content, this.plugin.app);

		if (!sectionInfos || sectionInfos.length === 0) return false;

		verifiedSectionInfos.push(...sectionInfos.map((sec) => sectionToTaskSectionInfo(sec)));
		this.setSectionInfos(verifiedSectionInfos);
		return true;
	}

	/**
	 * this method creates a LatexTask from a section information object. it creates a temp div element to hold the task.
	 */
	static fromSectionInfos(
		plugin: LatexCompilerPlugin,
		path: string,
		sectionInfos: TaskSectionInformation[],
		renderTarget?: HTMLElement | LatexRenderChild
	): LatexTask {
		if (sectionInfos.length === 0) {
			throw new Error('No section information provided for creating a task.');
		}
		const contents = sectionInfos.map((sec) => codeBlockToContent(sec.codeBlock));
		if (!contents.every((c) => c === contents[0])) {
			throw new Error(
				'All section contents must be the same for creating a task from multiple sections.',
			);
		}
		const content = contents[0];
		const metadatas = sectionInfos.map((sec) => extractCodeBlockMetadata(sec.codeBlock));
		const language = metadatas[0].language ?? '';
		if (!metadatas.every((meta) => meta.language === language)) {
			throw new Error(
				'All section metadata languages must be the same for creating a task from multiple sections.',
			);
		}

		let renderChild: LatexRenderChild | undefined;
		let containerEl: HTMLElement;

		if (renderTarget instanceof LatexRenderChild) {
			renderChild = renderTarget;
			containerEl = renderTarget.containerEl;
		} else {
			containerEl = renderTarget ?? activeDocument.createDocumentFragment().createDiv();
		}
		
		const definition = getLatexCodeBlockDefinition(language);

		return new LatexTask(
			plugin,
			language as LatexCodeBlockLanguage,
			definition,
			content,
			containerEl,
			renderChild,
			path,
			sectionInfos
		);
	}

	static async createAsync(
		plugin: LatexCompilerPlugin,
		codeBlockLanguage: LatexCodeBlockLanguage,
		definition: LatexCodeBlockDefinition,
		content: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	) {
		try {
			const mdSectionInfos = await mdSecInfosFromMdPostProcessorCtx(ctx, el, content, plugin.app);
			const infos = mdSectionInfos.map((sec) => sectionToTaskSectionInfo(sec));
			const rendererChild = new LatexRenderChild(el, plugin, ctx.sourcePath);
			ctx.addChild(rendererChild);
			const task = new LatexTask(plugin, codeBlockLanguage, definition, content, el, rendererChild, ctx.sourcePath, infos);
			return { isError: false, result: task };
		} catch (err: unknown) {
			console.error('Error while ensuring section info for task:', err);
			return { isError: true, result: err };
		}
	}

	getContent() {
		return this.content;
	}

	/**
	 * sets the section information for the task as well as dependent properties.
	 * @param infos
	 */
	protected setSectionInfos(infos: (TaskSectionInformation | MarkdownSectionInformation)[]) {
		for (const info of infos) {
			const taskInfo = 'text' in info ? sectionToTaskSectionInfo(info) : info;
			this.sectionInfos ??= [];
			this.sectionInfos.push(taskInfo);
		}

		this.sectionInfos.sort((a, b) => a.lineStart - b.lineStart);

		const numberKey = this.sectionInfos.map((sec) => sec.lineStart).join('|');
		this.blockId = this.sourcePath.replace(/ /g, '_') + '||' + numberKey;

		const names = [];
		for (const section of this.sectionInfos) {
			const line = section.codeBlock.split('\n')[0];
			const name = extractCodeBlockName(line);
			if (name) names.push(name);
		}
		this.possibleNames = names;
	}

	getBlockId() {
		if (!this.blockId) {
			throw new Error('Block ID is not set. Call setSectionInfo first.');
		}
		return this.blockId;
	}

	// Detached tasks have no DOM lifecycle.
	// Managed render tasks are valid only while their element is still attached.
	isStillValid() {
		return this.renderChild === undefined || this.el.isConnected;
	}

	getStem() {
		return getCacheId(
			this.rawHash,
			this.sourcePath,
			this.compilePipeline,
		);
	}

	getProcessedContent(): string {
		if (this.processedContent === undefined) throw new Error('Processed content is not set. Call process() first.');
		return this.processedContent;
	}

	setProcessedContent(content: string) {
		this.processedContent = content;
		this.resolvedHash = hashLatexContent(this.processedContent);
	}

	getPossibleNames() {
		return this.possibleNames;
	}

	async process() {
		if (this.definition.compilePipeline !== CompilePipeline.Process) {
			//fake it till you make it.
			this.setProcessedContent(this.getContent());
			this.processed = true;
			return;
		}

		const result = await this.plugin.latexRenderer.preprocessor.process(
			this.getContent(),
			this.sourcePath,
			this.definition.compilePipeline
		)
		this.setProcessedContent(result);

		this.processed = true;
	}

	getRenderData() {
		return {
			el: this.el,
			content: this.getProcessedContent(),
			rawHash: this.rawHash,
			sourcePath: this.sourcePath,
			stem: this.getStem(),
			format: this.resultFormat,
			compilePipeline: this.compilePipeline,
		};
	}

	getDebugInfo() {
		return {
			sourcePath: this.sourcePath,
			content: this.content,
			definition: this.definition,
			rawHash: this.rawHash,
			resolvedHash: this.resolvedHash,
			blockId: this.blockId,
			sectionInfos: this.sectionInfos.map((sec) => ({
				lineStart: sec.lineStart,
				lineEnd: sec.lineEnd,
				codeBlock: sec.codeBlock,
			})),
			lastSectionInfoVerificationTime: this.lastSectionInfoVerificationTime,
			processed: this.processed,
			possibleNames: this.possibleNames,
		};
	}
}
