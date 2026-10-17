declare module '*generated/pdfToSvgRuntime' {
	const factory: (options: { wasmBinary: Uint8Array }) => Promise<import('@pdf-to-svg-runtime').PdfToSvgModule>;
	export default factory;
}
