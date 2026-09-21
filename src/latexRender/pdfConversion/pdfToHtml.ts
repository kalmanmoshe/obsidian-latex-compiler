import { PDFDocument } from 'pdf-lib';
import LatexCompilerPlugin from 'src/main';
import { LATEX_RENDER_ID_KEY } from './pdfToSVG';
import { loadPdfJs, setIcon } from 'obsidian';
import { LatexRenderChild } from '../task/latexRenderChild';
import { CompilePipeline } from 'src/settings/settings';

export async function insertPdf(
	pdfData: Uint8Array,
	renderChild: LatexRenderChild,
	stem: string,
	sourcePath: string,
	compilePipeline: CompilePipeline,
	plugin: LatexCompilerPlugin,
) {
	const { attr, url } = await pdfToHtml(pdfData);
	const el = renderChild.containerEl;
	el.empty();
	renderChild.setObjectUrl(url);

	const wrapper = el.createDiv({
		cls: 'latex-pdf-wrapper',
		attr: {
			[LATEX_RENDER_ID_KEY]: stem,
		},
	});

	const toolbar = wrapper.createDiv({
		cls: 'latex-pdf-toolbar',
	});

	const menuButton = toolbar.createEl('button', {
		cls: 'latex-pdf-menu-button clickable-icon',
		attr: {
			type: 'button',
			'aria-label': 'Open LaTeX PDF actions',
			[LATEX_RENDER_ID_KEY]: stem,
		},
	});

	setIcon(menuButton, 'more-vertical');

	const pdfObject = wrapper.createEl('object', { attr });

	pdfObject.addClass('latex-pdf-object');
	pdfObject.setAttribute(LATEX_RENDER_ID_KEY, stem);

	const openMenu = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		plugin.menuDecider.openMenu(event, renderChild, sourcePath, compilePipeline);
	};

	plugin.registerDomEvent(menuButton, 'click', openMenu);
	plugin.registerDomEvent(menuButton, 'contextmenu', openMenu);
}


export async function insertPdfForExport(
	pdfData: Uint8Array,
	renderChild: LatexRenderChild,
	stem: string,
): Promise<void> {
	const container = renderChild.containerEl;
	const doc = container.ownerDocument;

	const pdfjsLib = await loadPdfJs();

	const loadingTask = pdfjsLib.getDocument({
		data: pdfData.slice(),
		ownerDocument: doc
	});

	const pdf = await loadingTask.promise;

	try {
		const page = await pdf.getPage(1);

		const viewport = page.getViewport({
			scale: 2,
		});

		const canvas = doc.createElement('canvas');
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);

		const context = canvas.getContext('2d');

		if (!context) {
			throw new Error('Failed to create canvas context for PDF export.');
		}

		await page.render({
			canvasContext: context,
			viewport,
			background: getPdfBackgroundColor(doc),
			intent: 'print',
		}).promise;

		canvas.classList.add('latex-pdf-export');
		canvas.setAttribute(LATEX_RENDER_ID_KEY, stem);

		container.replaceChildren(canvas);
	} finally {
		await pdf.destroy();
	}
}

function getPdfBackgroundColor(doc: Document) {
	const win = doc.defaultView;

	if (!win) {
		throw new Error('Export document has no window.');
	}

	const styles = win.getComputedStyle(doc.body);

	const pdfBackground =
		styles.getPropertyValue('--pdf-background').trim()
		|| styles.getPropertyValue('--background-primary').trim()
		|| '#ffffff';
	return pdfBackground;
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
