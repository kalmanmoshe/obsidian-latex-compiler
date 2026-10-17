// The subset of Obsidian's bundled PDF.js API used by this plugin.
export interface PdfViewport {
	width: number;
	height: number;
	scale: number;
}

export interface PdfRenderTask {
	promise: Promise<void>;
	cancel(): void;
}

export interface PdfPage {
	getViewport(options: { scale: number }): PdfViewport;
	render(options: {
		canvasContext: CanvasRenderingContext2D;
		viewport: PdfViewport;
		transform: number[];
		background: string;
		intent: 'display' | 'print';
	}): PdfRenderTask;
	getTextContent(): Promise<unknown>;
	cleanup(): void;
}

export interface PdfDocument {
	numPages: number;
	getPage(number: number): Promise<PdfPage>;
	destroy(): Promise<void>;
}

export interface PdfLoadingTask {
	promise: Promise<PdfDocument>;
	destroy(): Promise<void>;
}

export interface PdfJs {
	getDocument(options: { data: Uint8Array; ownerDocument: Document }): PdfLoadingTask;
	TextLayer: new (options: {
		textContentSource: unknown;
		container: HTMLElement;
		viewport: PdfViewport;
	}) => { render(): Promise<void> };
}
