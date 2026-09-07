import { MarkdownPostProcessorContext, Platform } from 'obsidian';
import { CompileResult, CompileStatus } from './compiler/base/compilerBase/engine';
import LatexCompilerPlugin from '../main';
import { CompilePipeline, CompilerType, ResultFileFormat } from 'src/settings/settings.js';
import { insertPdf } from './pdfConversion/pdfToHtml';
import parseLatexLog, { refactorLogToErrorMessage } from './logs/humanReadableLogs';
import { VirtualFileSystem } from '../latexPreprocessor/virtualFileSystem';
import { ProcessedLog } from './logs/latexLogParser';
import PdfTeXCompiler from './compiler/swiftlatexpdftex/PdfTeXCompiler';
import { LatexTask } from './task/latexTask';
import { PdfXeTeXCompiler } from './compiler/swiftlatexxetex/pdfXeTeXCompiler';
import LatexCompiler from './compiler/base/compilerBase/compiler';
import CompilerCache, { hashLatexContent } from './cache/compilerCache';
import { LatexRenderQueue } from './task/LatexRenderQueue';
import { LATEX_RENDER_ID_KEY, pdfToOptimizedSVG, insertSvg } from './pdfConversion/pdfToSVG';
import { CacheContent } from './cache/cacheBase/cacheBase';
import { LatexRenderChild } from './task/latexRenderChild';
import { LatexCodeBlockDefinition } from './codeBlockTypes';
import { ErrorLevel, ErrorMessage, errorMessageDiv } from './errors/errorDisplay';
import { LatexCompilationError, pluginErrorToErrorMessage, toErrorString, UserFacingPluginError } from './errors/pluginErrors';
import { LatexRenderCompilationSession } from './latexRenderCompilationSession';
import { getCacheId } from './cache/resultFileCache';
import { BasicLatexPreprocessor, LatexPreprocessor, SmartLatexPreprocessor } from 'src/latexPreprocessor/LatexPreprocessor';

export async function waitFor(condFunc: () => boolean): Promise<void> {
	while (!condFunc()) {
		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 100);
		});
	}
}

export class LatexRenderer {
	plugin: LatexCompilerPlugin;
	preprocessor: LatexPreprocessor;
	compiler?: LatexCompiler;
	cache: CompilerCache;
	queue?: LatexRenderQueue;

	async onload(plugin: LatexCompilerPlugin) {
		this.plugin = plugin;
		this.cache = new CompilerCache(this.plugin);
		if (this.isNotIos()) {
			await this.loadCompiler();

			this.queue = new LatexRenderQueue((t) => this.processAndRenderLatexTask(t));
		}
		this.ensurePreprocessor();
	}

	ensurePreprocessor() {
		//It might be called before onload
		if (!this.plugin) return;

		const shouldBeSmart = this.plugin.settings.experimentalSmartPreprocessing;

		const isSmart = this.preprocessor instanceof SmartLatexPreprocessor;

		if (this.preprocessor !== undefined && shouldBeSmart === isSmart) {
			return;
		}

		this.preprocessor = shouldBeSmart
			? new SmartLatexPreprocessor(this.plugin, new VirtualFileSystem(), this.plugin.app)
			: new BasicLatexPreprocessor();
	}

	switchCompiler(): Promise<void> {
		if (this.compiler === undefined) return this.loadCompiler();

		const isTex =
			this.compiler instanceof PdfTeXCompiler &&
			this.plugin.settings.compiler === CompilerType.PdfTeX;

		const isXeTeX =
			this.compiler instanceof PdfXeTeXCompiler &&
			this.plugin.settings.compiler === CompilerType.XeTeX;

		if (isTex || isXeTeX) return Promise.resolve();

		this.compiler.closeWorkers();
		this.compiler = undefined;

		return this.loadCompiler();
	}

	private async loadCompiler() {
		if (this.plugin.settings.compiler === CompilerType.PdfTeX) {
			this.compiler = new PdfTeXCompiler();
		} else {
			this.compiler = new PdfXeTeXCompiler();
		}

		await this.compiler.loadEngines();
		await this.cache.loadPackageCache();
		await this.compiler.setTexliveEndpoint(this.plugin.settings.package_url);
	}

	async restartCompiler() {
		this.compiler?.closeWorkers();
		this.queue?.abortAllWaiting();
		await this.loadCompiler();
	}

	// i have to also cache the files refrenced my the hash and thar loction becose thar can i a file that is Referencing the same files.But because it's in a different directory, those files in actuality are different, leading to a different render.
	async codeBlockProcessor(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		definition: LatexCodeBlockDefinition,
	) {
		el.classList.add(
			'latex-compiler-render',
			`latex-compiler-overflow-${this.plugin.settings.overflowStrategy}`,
		);

		const rawHash = hashLatexContent(source);
		const createResult = await LatexTask.createAsync(this.plugin, definition, source, el, ctx);

		if (createResult.isError) {
			const child = new LatexRenderChild(el);
			ctx.addChild(child);
			this.displayError(
				child,
				createResult.result,
				getCacheId(rawHash, ctx.sourcePath, definition.compilePipeline),
				ctx.sourcePath,
				definition.compilePipeline
			);
			return;
		}

		const task = createResult.result as LatexTask;

		try {
			// PDF file has already been cached
			// Could have a case where pdfCache has the key but the cached file has been deleted
			const wasRestoredFromCache = await this.restoreFromCache(task);
			if (wasRestoredFromCache) return;
		} catch (err) {
			console.error('Error restoring from cache:', err, task.getDebugInfo());
		}

		this.queue?.push(task);
	}

	/**
	 * Processes and renders the given LaTeX task.
	 *
	 * @param task The task to process and render.
	 * @returns `true` if the task was compiled and rendered; `false` if it was restored from cache or failed during processing.
	 */
	private async processAndRenderLatexTask(task: LatexTask): Promise<boolean> {
		if (await this.restoreFromCache(task)) {
			return false;
		}

		if (await this.shouldSkipStaleTask(task)) return false;

		if (!this.compiler?.isResponsive()) {
			console.error('Compiler is unresponsive. Aborting task:', task.getDebugInfo());
			this.displayErrorForTask(
				task,
				new UserFacingPluginError(
					'Compiler unresponsive',
					'The LaTeX compiler is not responding. Restart the compiler and try again.',
				),
			);
			return false;
		}

		try {
			await task.process();
		} catch (processError) {
			console.error('Error processing task:', processError, task.getDebugInfo());
			this.displayErrorForTask(task, processError);
			return false;
		}

		console.log('Rendering task:', task.getDebugInfo());

		await this.renderLatexToElement(task);
		await this.reCheckQueue(); // only re-check the queue after a valide rendering
		return true;
	}

	private async shouldSkipStaleTask(task: LatexTask): Promise<boolean> {
		if (!task.isStillValid() || !task.hasSourceChangeTimeExceededMargin()) return false;
		if (await task.verifySource()) return false;

		if (this.hasNewerQueuedTask(task)) {
			console.warn('Skipping stale task because a newer task exists:', task.getDebugInfo());
			return true;
		}

		console.error('Source files changed and could not be resolved:', task.getDebugInfo());

		this.displayErrorForTask(
			task,
			new UserFacingPluginError(
				'Source changed during rendering',
				'The source changed while this LaTeX block was being processed. Rerender the block to try again.',
			)
		);

		return true;
	}

	private hasNewerQueuedTask(task: LatexTask): boolean {
		if (!this.isNotIos()) return false;

		return this.queue
			.getWaitingTasks()
			.some((waitingTask) => waitingTask.getBlockId() === task.getBlockId());
	}

	async detachedProcessAndRender(task: LatexTask) {
		if (!this.compiler?.isResponsive()) {
			console.error('Compiler is unresponsive. Aborting task:', task.getDebugInfo());
			return {
				result: new CompileResult(
					undefined,
					CompileStatus.EngineCrashed,
					'Compiler is unresponsive. Please restart the compiler.',
				),
				compilationSession: undefined,
			};
		}
		try {
			await task.process();
		} catch (err) {
			console.error('Error processing task:', err, task.getDebugInfo());
			const errorMessage = toErrorString(err);
			return {
				result: new CompileResult(undefined, CompileStatus.ProcessingError, errorMessage),
				compilationSession: undefined
			};
		}

		try {
			const latexRenderResult = await this.renderLatexToPDF(
				task.getProcessedContent(),
				task.sourcePath
			);
			return latexRenderResult;
		} catch (err) {
			let errorText, session: LatexRenderCompilationSession | undefined;
			if (err instanceof LatexCompilationError) {
				errorText = err.latexLog;
				session = err.session;
			} else {
				errorText = toErrorString(err);
			}
			return {
				result: new CompileResult(undefined, CompileStatus.CompileError, errorText),
				compilationSession: session
			};
		}
	}

	/**
	 * Re-checks the queue to see if any tasks can be removed based on whether their PDF has been restored from cache.
	 * If a task's PDF cannot be restored, it is removed from the queue.
	 * Solves edge case where head is in the processing state when a similar task is registered to the universal method
	 */
	private async reCheckQueue() {
		if (!this.queue) return;
		const blockIdsToRemove = new Set<string>();
		const waitingTasks = this.queue.getWaitingTasks();

		for (const task of waitingTasks) {
			if (await this.restoreFromCache(task)) {
				blockIdsToRemove.add(task.getBlockId());
			}
		}

		if (blockIdsToRemove.size === 0) return;

		this.queue.removeFromWaiting((task) => blockIdsToRemove.has(task.getBlockId()));
	}

	async onunload() {
		this.compiler?.closeWorkers();
	}

	private displayErrorForTask(
		task: LatexTask,
		err: unknown
	): void {
		// there is nothing to display the error to, so we just return.
		if (!task.renderChild) return;
		this.displayError(task.renderChild, err, task.getStem(), task.sourcePath, task.compilePipeline);
	}

	private displayError(
		renderChild: LatexRenderChild,
		err: unknown,
		cacheId: string,
		sourcePath: string,
		pipeline: CompilePipeline,
	): void {
		const el = renderChild.containerEl;
		el.innerHTML = '';

		let processedError: ErrorMessage;
		if (err instanceof LatexCompilationError) {
			const processedLog: ProcessedLog = this.cache.getLog(cacheId)?.log || parseLatexLog(err.latexLog);
			processedError = refactorLogToErrorMessage(processedLog);
		} else {
			processedError = pluginErrorToErrorMessage(err)
		}

		const child = errorMessageDiv(processedError, ErrorLevel.Error);
		child.setAttribute(LATEX_RENDER_ID_KEY, cacheId);
		el.appendChild(child);
		this.plugin.menuDecider.add(renderChild, sourcePath, pipeline)
	}

	private async renderLatexToElement(task: LatexTask): Promise<void> {
		const { content, rawHash, sourcePath, stem, compilePipeline, format } = task.getRenderData();

		try {
			const { result, compilationSession } = await this.renderLatexToPDF(
				content,
				sourcePath,
				{
					fetchPkgData: true,
					cacheId: getCacheId(rawHash, sourcePath, compilePipeline),
				}
			);

			const resultFile = await this.createResultFile(result.pdf, stem, format);

			await this.renderResultFile(task, resultFile);

			await this.cache.resultFileCache.addFile(
				resultFile,
				rawHash,
				sourcePath,
				compilationSession.createContentHashRecord(),
				compilePipeline,
				format
			);
		} catch (err: unknown) {
			console.error('Error rendering LaTeX to element:', err);
			this.displayErrorForTask(task, err);
		} finally {
			if (!this.compiler?.isResponsive()) {
				console.warn('Compiler is unresponsive.');
			} else {
				await this.compiler?.waitUntilReady();
			}
		}
	}

	private async renderLatexToPDF(
		source: string,
		sourcePath: string,
		config: { fetchPkgData?: boolean; cacheId?: string } = {},
	): Promise<{ result: CompileResult; compilationSession: LatexRenderCompilationSession }> {
		await this.compiler!.waitUntilReady();

		await this.compiler!.flushWorkCache();
		await this.compiler!.writeMemFSFile('main.tex', source);
		await this.compiler!.setEngineMainFile(0, 'main.tex');

		const compilationSession = new LatexRenderCompilationSession(this, sourcePath);
		const result = await this.compiler!.compileLaTeX(compilationSession);

		console.log('Compilation result:', result, compilationSession);

		if (config.cacheId) {
			this.cache.addLog(config.cacheId, result.log, compilationSession);
		}

		if (config.fetchPkgData) {
			await this.cache.fetchPackageCacheData();
		}

		if (!result.isStatus(CompileStatus.Success)) {
			throw new LatexCompilationError(result.log, compilationSession);
		}

		return { result, compilationSession };
	}

	private async createResultFile(pdfData: Uint8Array, stem: string, format: ResultFileFormat): Promise<CacheContent> {
		if (format === 'pdf') return pdfData;

		const config = {
			invertColorsInDarkMode: this.plugin.settings.invertColorsInDarkMode,
			autoRemoveWhitespace: this.plugin.settings.autoRemoveWhitespace,
			stem,
		};

		return await pdfToOptimizedSVG(pdfData, config)
	}

	private async restoreFromCache(task: LatexTask) {
		const result = await this.cache.resultFileCache.getResultFile(
			task.rawHash,
			task.sourcePath,
			task.compilePipeline,
			task.resultFormat
		);
		if (result === undefined) return false;

		return this.renderResultFile(task, result.data);
	}

	private async renderResultFile(
		task: LatexTask,
		data: CacheContent,
	): Promise<boolean> {
		// using getStem here will work fine and we dont have to worry about it not being generated yet because we are only calling this function after a successful compilation/fetch from cache, which will always generate the stem before calling this function.
		const renderChild = task.renderChild, stem = task.getStem();
		//we successfully restored from cache, but the task has no renderer child to render to. 
		if (!renderChild) return true;

		if (task.resultFormat === 'svg') {
			if (typeof data !== 'string') {
				console.warn(`Expected SVG cache entry ${stem} to contain text data.`);
				return false;
			}

			insertSvg(data, renderChild, task.sourcePath, task.compilePipeline, this.plugin);
			return true;
		}

		if (!(data instanceof Uint8Array)) {
			console.warn(
				`Expected PDF cache entry ${stem} to contain binary data.`,
			);
			return false;
		}

		await insertPdf(
			data,
			renderChild,
			stem,
			task.sourcePath,
			task.compilePipeline,
			this.plugin,
		);

		return true;
	}

	isNotIos(): this is LatexRenderer & {
		queue: LatexRenderQueue;
		compiler: LatexCompiler;
	} {
		return !Platform.isIosApp;
	}
}
