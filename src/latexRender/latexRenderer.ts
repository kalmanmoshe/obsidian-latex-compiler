import { MarkdownPostProcessorContext, Platform } from 'obsidian';
import { CompileResult, CompileStatus } from './compiler/base/compilerBase/engine';
import LatexCompilerPlugin from '../main';
import { CompilerType, ResultFileFormat } from 'src/settings/settings.js';
import { insertPdf, insertPdfForExport, insertPdfWithPdfJs } from './pdfConversion/pdfToHtml';
import parseLatexLog, { refactorLogToErrorMessage } from './logs/humanReadableLogs';
import { VirtualFileSystem } from '../latexPreprocessor/virtualFileSystem';
import { ProcessedLog } from './logs/latexLogParser';
import PdfTeXCompiler from './compiler/swiftlatexpdftex/pdfTeXCompiler';
import { LatexTask, LatexTaskPriority } from './task/latexTask';
import { PdfXeTeXCompiler } from './compiler/swiftlatexxetex/pdfXeTeXCompiler';
import LatexCompiler from './compiler/base/compilerBase/compiler';
import CompilerCache, { hashLatexContent } from './cache/compilerCache';
import { LatexRenderQueue } from './task/latexRenderQueue';
import { LATEX_RENDER_ID_KEY, pdfToOptimizedSVG, insertSvg } from './pdfConversion/pdfToSVG';
import { CacheContent } from './cache/cacheBase/cacheBase';
import { LatexRenderChild } from './task/latexRenderChild';
import { LatexCodeBlockDefinition, LatexCodeBlockLanguage } from './codeBlockTypes';
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

		await this.syncCompilerState();

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

	async syncCompilerState(): Promise<void> {
		const shouldBeEnabled =
			this.plugin.getLocalStorageSettings().enableCompilerOnThisDevice;

		const isEnabled = this.compiler !== undefined && this.queue !== undefined;

		if (shouldBeEnabled === isEnabled) {
			return;
		}

		if (shouldBeEnabled) {
			await this.startCompiler();
		} else {
			this.stopCompiler();
		}
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
		if (!this.isCompilerEnabled()) return;
		if (this.plugin.settings.compiler === CompilerType.PdfTeX) {
			this.compiler = new PdfTeXCompiler();
		} else {
			this.compiler = new PdfXeTeXCompiler();
		}

		await this.compiler.loadEngines();
		await this.cache.loadTexLiveCache();
		await this.compiler.setTexliveEndpoint(this.plugin.settings.package_url);
	}

	async restartCompiler() {
		this.stopCompiler();
		if (!this.isCompilerEnabled()) return;
		await this.startCompiler();
	}

	private async startCompiler(): Promise<void> {
		if (this.compiler || this.queue) return;

		await this.loadCompiler();

		this.queue = new LatexRenderQueue({
			validate: async (task) => !(await this.shouldSkipStaleTask(task)),
			prepare: (task) => this.prepareResultFile(task),
			render: async (task, data) => {
				if (!(await this.renderResultFile(task, data))) {
					throw new Error(
						'The compiled result does not match the requested output format.',
					);
				}
			},
			showError: (task, error) => this.displayErrorForTask(task, error),
		});
	}

	private stopCompiler(): void {
		this.queue?.dispose();
		this.queue = undefined;

		this.compiler?.closeWorkers();
		this.compiler = undefined;
	}

	// i have to also cache the files refrenced my the hash and thar loction becose thar can i a file that is Referencing the same files.But because it's in a different directory, those files in actuality are different, leading to a different render.
	async codeBlockProcessor(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		codeBlockLanguage: LatexCodeBlockLanguage,
		definition: LatexCodeBlockDefinition,
	) {
		el.classList.add('latex-compiler-render');

		if (definition.resultFormat === 'svg') {
			el.classList.add(
				`latex-compiler-overflow-${this.plugin.settings.overflowStrategy}`,
			);
		}

		const rawHash = hashLatexContent(source);
		const createResult = await LatexTask.createAsync(
			this.plugin,
			codeBlockLanguage,
			definition,
			source,
			el,
			ctx,
		);

		if (createResult.isError) {
			const child = new LatexRenderChild(el, this.plugin, ctx.sourcePath);
			ctx.addChild(child);
			this.displayError(
				child,
				createResult.result,
				getCacheId(rawHash, ctx.sourcePath, definition.compilePipeline),
				ctx.sourcePath,
				codeBlockLanguage,
			);
			return;
		}

		const task = createResult.result as LatexTask;

		if (await this.restoreFromCache(task)) return;

		if (!this.isCompilerEnabled()) {
			el.replaceChildren(
				errorMessageDiv(
					{
						title: 'Compiler disabled',
						explanation:
							'The LaTeX compiler is disabled on this device. and no result file was fund in the cache for this codeblokc. Enable it in the plugin settings to render LaTeX.',
					},
					ErrorLevel.Info,
				),
			);
		} else {
			const isPdfExport = isPdfExportRender(el);
			const priority = isPdfExport
				? LatexTaskPriority.Export
				: LatexTaskPriority.Regular;
			const completion = this.queue.push(task, priority);

			if (isPdfExport) {
				await completion;
			} else {
				void completion.catch((err) => {
					console.error('Queue worker crashed:', err);
				});
			}
		}
	}

	/** Read/compile shared data without rendering into a particular pane. */
	private async prepareResultFile(task: LatexTask): Promise<CacheContent> {
		try {
			const cached = await this.cache.resultFileCache.getResultFile(
				task.rawHash,
				task.sourcePath,
				task.compilePipeline,
				task.resultFormat,
			);
			if (
				cached !== undefined &&
				(task.resultFormat === 'svg'
					? typeof cached.data === 'string'
					: cached.data instanceof Uint8Array)
			)
				return cached.data;
		} catch (error) {
			console.warn('Could not read LaTeX cache; compiling instead:', error);
		}

		if (!this.compiler?.isResponsive()) {
			throw new UserFacingPluginError(
				'Compiler unresponsive',
				'The LaTeX compiler is not responding. Restart the compiler and try again.',
			);
		}
		await task.process();
		return this.compileResultFile(task);
	}

	private async shouldSkipStaleTask(task: LatexTask): Promise<boolean> {
		if (!task.isStillValid()) return true;
		if (!task.hasSourceChangeTimeExceededMargin()) return false;
		if (await task.verifySource()) return false;

		this.displayErrorForTask(
			task,
			new UserFacingPluginError(
				'Source changed during rendering',
				'The source changed while this LaTeX block was being processed. Rerender the block to try again.',
			),
		);
		return true;
	}

	async detachedProcessAndRender(task: LatexTask) {
		if (!this.compiler?.isResponsive()) {
			console.error(
				'Compiler is unresponsive. Aborting task:',
				task.getDebugInfo(),
			);
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
				result: new CompileResult(
					undefined,
					CompileStatus.ProcessingError,
					errorMessage,
				),
				compilationSession: undefined,
			};
		}

		try {
			const latexRenderResult = await this.renderLatexToPDF(
				task.getProcessedContent(),
				task.sourcePath,
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
				result: new CompileResult(
					undefined,
					CompileStatus.CompileError,
					errorText,
				),
				compilationSession: session,
			};
		}
	}

	async onunload() {
		this.stopCompiler();
	}

	private displayErrorForTask(task: LatexTask, err: unknown): void {
		// there is nothing to display the error to, so we just return.
		if (!task.renderChild || task.renderChild.isUnloaded) return;
		this.displayError(
			task.renderChild,
			err,
			task.getStem(),
			task.sourcePath,
			task.codeBlockLanguage,
		);
	}

	private displayError(
		renderChild: LatexRenderChild,
		err: unknown,
		cacheId: string,
		sourcePath: string,
		codeBlockLanguage: LatexCodeBlockLanguage,
	): void {
		if (renderChild.isUnloaded) return;
		const el = renderChild.containerEl;
		el.innerHTML = '';

		let processedError: ErrorMessage;
		if (err instanceof LatexCompilationError) {
			const processedLog: ProcessedLog = this.cache.getLog(cacheId)?.log || parseLatexLog(err.latexLog);
			processedError = refactorLogToErrorMessage(processedLog);
		} else {
			processedError = pluginErrorToErrorMessage(err);
		}

		const child = errorMessageDiv(processedError, ErrorLevel.Error);
		child.setAttribute(LATEX_RENDER_ID_KEY, cacheId);
		el.appendChild(child);
		this.plugin.menuDecider.add(renderChild, sourcePath, codeBlockLanguage)
	}

	private async compileResultFile(task: LatexTask): Promise<CacheContent> {
		const { content, rawHash, sourcePath, stem, compilePipeline, format } =
			task.getRenderData();

		try {
			const { result, compilationSession } = await this.renderLatexToPDF(
				content,
				sourcePath,
				{
					fetchPkgData: true,
					cacheId: getCacheId(rawHash, sourcePath, compilePipeline),
				},
			);

			const resultFile = await this.createResultFile(result.pdf, stem, format);

			try {
				await this.cache.resultFileCache.addFile(
					resultFile,
					rawHash,
					sourcePath,
					compilationSession.createContentHashRecord(),
					compilePipeline,
					format,
				);
			} catch (error) {
				// A persistence failure must not discard a successful compilation.
				console.warn(
					'Could not save the compiled LaTeX result to cache:',
					error,
				);
			}
			return resultFile;
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
	): Promise<{
		result: CompileResult;
		compilationSession: LatexRenderCompilationSession;
	}> {
		await this.compiler!.waitUntilReady();
		await this.compiler!.flushWorkCache();
		await this.compiler!.writeMemFSFile('main.tex', source);
		await this.compiler!.setEngineMainFile(0, 'main.tex');

		const compilationSession = new LatexRenderCompilationSession(
			this,
			sourcePath,
		);
		const result = await this.compiler!.compileLaTeX(compilationSession);

		if (config.cacheId) {
			this.cache.addLog(config.cacheId, result.log, compilationSession);
		}

		if (config.fetchPkgData) {
			await this.cache.fetchTexLiveCacheData();
		}

		if (!result.isStatus(CompileStatus.Success)) {
			throw new LatexCompilationError(result.log, compilationSession);
		}

		return { result, compilationSession };
	}

	private async createResultFile(
		pdfData: Uint8Array,
		stem: string,
		format: ResultFileFormat,
	): Promise<CacheContent> {
		if (format === 'pdf') return pdfData;

		const config = {
			adaptSVGColorsToTheme: this.plugin.settings.adaptSVGColorsToTheme,
			stem,
		};

		return await pdfToOptimizedSVG(pdfData, config);
	}

	private async restoreFromCache(task: LatexTask) {
		try {
			const result = await this.cache.resultFileCache.getResultFile(
				task.rawHash,
				task.sourcePath,
				task.compilePipeline,
				task.resultFormat,
			);
			if (result === undefined) return false;
			return this.renderResultFile(task, result.data);
		} catch (err) {
			console.error('Error restoring from cache:', err, task.getDebugInfo());
			return false;
		}
	}

	private async renderResultFile(
		task: LatexTask,
		data: CacheContent,
	): Promise<boolean> {
		// using getStem here will work fine and we dont have to worry about it not being generated yet because we are only calling this function after a successful compilation/fetch from cache, which will always generate the stem before calling this function.
		const renderChild = task.renderChild, stem = task.getStem();
		//we successfully restored from cache, but the task has no renderer child to render to.
		if (!renderChild || renderChild.isUnloaded) return true;

		if (task.resultFormat === 'svg') {
			if (typeof data !== 'string') {
				console.warn(`Expected SVG cache entry ${stem} to contain text data.`);
				return false;
			}

			insertSvg(
				data,
				renderChild,
				task.sourcePath,
				task.codeBlockLanguage,
				this.plugin,
			);
			return true;
		}

		if (!(data instanceof Uint8Array)) {
			console.warn(`Expected PDF cache entry ${stem} to contain binary data.`);
			return false;
		}

		if (isPdfExportRender(renderChild.containerEl)) {
			await insertPdfForExport(data, renderChild, stem);
		} else if (Platform.isAndroidApp) {
			await insertPdfWithPdfJs(
				data,
				renderChild,
				stem,
				task.sourcePath,
				task.codeBlockLanguage,
				this.plugin,
			);
		} else {
			await insertPdf(
				data,
				renderChild,
				stem,
				task.sourcePath,
				task.codeBlockLanguage,
				this.plugin,
			);
		}

		return true;
	}

	isCompilerEnabled(): this is LatexRenderer & {
		queue: LatexRenderQueue;
		compiler: LatexCompiler;
	} {
		return this.plugin.getLocalStorageSettings().enableCompilerOnThisDevice;
	}
}

function isPdfExportRender(el: HTMLElement): boolean {
	const doc = el.ownerDocument;

	return (
		doc.location.href === 'about:blank' &&
		doc.body.querySelector(':scope > .print') !== null
	);
 }
