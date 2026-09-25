import { PDFDocument } from 'pdf-lib';
import LatexCompilerPlugin from 'src/main';
import { LATEX_RENDER_ID_KEY } from './pdfToSVG';
import { loadPdfJs, setIcon } from 'obsidian';
import { LatexRenderChild } from '../task/latexRenderChild';
import { CompilePipeline } from 'src/settings/settings';

type PdfJs = Awaited<ReturnType<typeof loadPdfJs>>;
type LoadingTask = ReturnType<PdfJs['getDocument']>;
type Pdf = Awaited<LoadingTask['promise']>;
type PdfPage = Awaited<ReturnType<Pdf['getPage']>>;
type PageRenderTask = ReturnType<PdfPage['render']>;

type PdfShell = {
	wrapper: HTMLDivElement;
	toolbar: HTMLDivElement;
};

function createPdfShell(
	renderChild: LatexRenderChild,
	stem: string,
	sourcePath: string,
	compilePipeline: CompilePipeline,
	plugin: LatexCompilerPlugin,
): PdfShell {
	const container = renderChild.containerEl;
	const doc = container.ownerDocument;

	const wrapper = doc.createElement('div');
	wrapper.className = 'latex-pdf-wrapper';
	wrapper.setAttribute(LATEX_RENDER_ID_KEY, stem);

	const toolbar = doc.createElement('div');
	toolbar.className = 'latex-pdf-toolbar';

	const menuButton = doc.createElement('button');
	menuButton.type = 'button';
	menuButton.className = 'latex-pdf-menu-button clickable-icon';
	menuButton.setAttribute('aria-label', 'Open LaTeX PDF actions');
	menuButton.setAttribute(LATEX_RENDER_ID_KEY, stem);
	setIcon(menuButton, 'more-vertical');

	const openMenu = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();

		plugin.menuDecider.openMenu(
			event,
			renderChild,
			sourcePath,
			compilePipeline,
		);
	};

	// The listeners live as long as this render, rather than until plugin unload.
	renderChild.registerDomEvent(menuButton, 'click', openMenu);
	renderChild.registerDomEvent(menuButton, 'contextmenu', openMenu);

	toolbar.appendChild(menuButton);
	wrapper.appendChild(toolbar);
	container.replaceChildren(wrapper);

	return { wrapper, toolbar };
}

async function openPdfJs(
	pdfData: Uint8Array,
	doc: Document,
): Promise<{ loadingTask: LoadingTask; pdf: Pdf }> {
	const pdfjsLib = await loadPdfJs();

	const loadingTask = pdfjsLib.getDocument({
		// PDF.js may transfer its input. Preserve the cache's Uint8Array.
		data: pdfData.slice(),
		ownerDocument: doc,
	});

	return {
		loadingTask,
		pdf: await loadingTask.promise,
	};
}

async function paintPdfPage(
	page: PdfPage,
	doc: Document,
	options: {
		scale: number;
		outputScale: number;
		background: string;
		intent: 'display' | 'print';
		onTask?: (task: PageRenderTask | undefined) => void;
	},
): Promise<{
	canvas: HTMLCanvasElement;
	viewport: ReturnType<PdfPage['getViewport']>;
}> {
	const viewport = page.getViewport({ scale: options.scale });
	const canvas = doc.createElement('canvas');

	canvas.width = Math.ceil(viewport.width * options.outputScale);
	canvas.height = Math.ceil(viewport.height * options.outputScale);
	canvas.style.width = `${viewport.width}px`;
	canvas.style.height = `${viewport.height}px`;

	const context = canvas.getContext('2d', { alpha: false });
	if (!context) {
		throw new Error('Failed to create canvas context for PDF.');
	}

	const task = page.render({
		canvasContext: context,
		viewport,
		transform: [
			options.outputScale, 0,
			0, options.outputScale,
			0, 0,
		],
		background: options.background,
		intent: options.intent,
	});

	options.onTask?.(task);

	try {
		await task.promise;
		return { canvas, viewport };
	} catch (error) {
		canvas.width = 0;
		canvas.height = 0;
		throw error;
	} finally {
		options.onTask?.(undefined);
	}
}

export async function insertPdf(
	pdfData: Uint8Array,
	renderChild: LatexRenderChild,
	stem: string,
	sourcePath: string,
	compilePipeline: CompilePipeline,
	plugin: LatexCompilerPlugin,
): Promise<void> {
	const { attr, url } = await pdfToHtml(pdfData);

	if (renderChild.isUnloaded) {
		URL.revokeObjectURL(url);
		return;
	}

	renderChild.disposeRenderer();
	renderChild.setObjectUrl(url);

	const shell = createPdfShell(
		renderChild,
		stem,
		sourcePath,
		compilePipeline,
		plugin,
	);

	const pdfObject = renderChild.containerEl.ownerDocument.createElement(
		'object',
	);

	for (const [name, value] of Object.entries(attr)) {
		pdfObject.setAttribute(name, value);
	}

	pdfObject.classList.add('latex-pdf-object');
	pdfObject.setAttribute(LATEX_RENDER_ID_KEY, stem);
	shell.wrapper.appendChild(pdfObject);
}

export async function insertPdfForExport(
	pdfData: Uint8Array,
	renderChild: LatexRenderChild,
	stem: string,
): Promise<void> {
	const container = renderChild.containerEl;
	const doc = container.ownerDocument;
	const { pdf } = await openPdfJs(pdfData, doc);

	try {
		const page = await pdf.getPage(1);

		try {
			const viewport = page.getViewport({ scale: 1 });

			const { canvas } = await paintPdfPage(page, doc, {
				scale: 1,
				outputScale: 2,
				background: '#ffffff',
				intent: 'print',
			});

			canvas.style.width = `${viewport.width}px`;
			canvas.style.height = 'auto';
			canvas.style.maxWidth = '100%';

			if (renderChild.isUnloaded) {
				canvas.width = 0;
				canvas.height = 0;
				return;
			}

			renderChild.disposeRenderer();

			canvas.classList.add('latex-pdf-export');
			canvas.setAttribute(LATEX_RENDER_ID_KEY, stem);

			container.replaceChildren(canvas);
		} finally {
			page.cleanup();
		}
	} finally {
		await pdf.destroy();
	}
}

export async function insertPdfWithPdfJs(
	pdfData: Uint8Array,
	renderChild: LatexRenderChild,
	stem: string,
	sourcePath: string,
	compilePipeline: CompilePipeline,
	plugin: LatexCompilerPlugin,
): Promise<void> {
	const container = renderChild.containerEl;
	const doc = container.ownerDocument;
	const win = doc.defaultView;

	if (!win) {
		throw new Error('PDF container is not attached to a window.');
	}

	let disposed = false;
	let loadingTask: LoadingTask | undefined;
	let pdf: Pdf | undefined;
	let activeRender: PageRenderTask | undefined;
	let destroyPromise: Promise<void> | undefined;

	const canvases: HTMLCanvasElement[] = [];

	const destroyDocument = (): Promise<void> => {
		// Do not memoize a resolved promise before a task exists.
		if (!loadingTask) return Promise.resolve();

		destroyPromise ??= pdf
			? pdf.destroy()
			: loadingTask.destroy();

		return destroyPromise!;
	};

	renderChild.setRendererDisposer(() => {
		disposed = true;
		activeRender?.cancel();

		for (const canvas of canvases) {
			canvas.width = 0;
			canvas.height = 0;
		}

		void destroyDocument().catch(console.error);
	});

	try {
		const pdfjsLib = await loadPdfJs();
		if (disposed) return;

		loadingTask = pdfjsLib.getDocument({
			data: pdfData.slice(),
			ownerDocument: doc,
		});

		pdf = await loadingTask.promise;
		if (disposed) return;

		const firstPage = await pdf.getPage(1);
		if (disposed) return;

		const firstViewport = firstPage.getViewport({ scale: 1 });

		const shell = createPdfShell(
			renderChild,
			stem,
			sourcePath,
			compilePipeline,
			plugin,
		);

		const viewer = doc.createElement('div');
		viewer.className = 'latex-pdf-js-viewer';
		viewer.style.aspectRatio =
			`${firstViewport.width} / ${firstViewport.height}`;

		const pagesEl = doc.createElement('div');
		pagesEl.className = 'latex-pdf-js-pages pdfViewer';
		viewer.appendChild(pagesEl);
		shell.wrapper.appendChild(viewer);

		// The CSS reserves scrollbar width before measuring the page.
		const pageWidth = viewer.clientWidth || firstViewport.width;
		const outputScale = Math.min(win.devicePixelRatio || 1, 2);

		for (let number = 1; number <= pdf.numPages; number++) {
			if (disposed) return;

			const page =
				number === 1 ? firstPage : await pdf.getPage(number);
			if (disposed) return;

			try {
				const natural = page.getViewport({ scale: 1 });
				const scale = pageWidth / natural.width;
				const display = page.getViewport({ scale });

				const pageEl = doc.createElement('div');
				pageEl.className = 'latex-pdf-js-page page';
				pageEl.dataset.pageNumber = String(number);
				pageEl.style.width = `${display.width}px`;
				pageEl.style.height = `${display.height}px`;
				pageEl.style.setProperty(
					'--scale-factor',
					String(display.scale),
				);

				const canvasWrapper = doc.createElement('div');
				canvasWrapper.className = 'canvasWrapper';

				const textLayerEl = doc.createElement('div');
				textLayerEl.className = 'textLayer';

				pageEl.append(canvasWrapper, textLayerEl);
				pagesEl.appendChild(pageEl);

				const { canvas } = await paintPdfPage(page, doc, {
					scale,
					outputScale,
					background: '#ffffff',
					intent: 'display',
					onTask: task => {
						activeRender = task;
					},
				});

				if (disposed) {
					canvas.width = 0;
					canvas.height = 0;
					return;
				}

				canvases.push(canvas);
				canvasWrapper.appendChild(canvas);

				const textContent = await page.getTextContent();
				if (disposed) return;

				const textLayer = new pdfjsLib.TextLayer({
					textContentSource: textContent,
					container: textLayerEl,
					viewport: display,
				});

				await textLayer.render();
			} finally {
				page.cleanup();
			}
		}
	} catch (error) {
		// Destroying the loading task or cancelling a page rejects its promise.
		if (!disposed) {
			renderChild.disposeRenderer();
			throw error;
		}
	}
}

async function pdfToHtml(pdfData: Uint8Array) {
	const { width, height } = await getPdfDimensions(pdfData);
	const ratio = width / height;

	const arrayBuffer = pdfData.buffer.slice(
		pdfData.byteOffset,
		pdfData.byteOffset + pdfData.byteLength,
	) as ArrayBuffer;

	const pdfblob = new Blob([arrayBuffer], { type: 'application/pdf' });
	const objectURL = URL.createObjectURL(pdfblob);
	return {
		attr: {
			data: `${objectURL}#view=FitH&toolbar=0`,
			type: 'application/pdf',
			class: 'block-language-latex',
			style: `width:100%; aspect-ratio:${ratio}`,
		},
		url: objectURL
	};
}

// Obsidian's PDF.js could remove aprx 0.2mb of pdf-lib code from main.js.
// In a test with concurrent renders, pdf-lib took aprx 3ms per PDF,
// while PDF.js took aprx 460ms to load each document.
async function getPdfDimensions(pdf: Uint8Array): Promise<{ width: number; height: number }> {
	const pdfDoc = await PDFDocument.load(pdf);
	const firstPage = pdfDoc.getPages()[0];
	const { width, height } = firstPage.getSize();
	return { width, height };
}
