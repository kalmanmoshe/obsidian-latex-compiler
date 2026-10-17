import { decompressGzipBytes } from 'src/util/decompressPayload';
import { pdfToSvgWasmGzipBase64 } from '../../generated/pdfToSvgWasm.payload';
import createPdfToSvgModule from '../../generated/pdfToSvgRuntime';

type PdfToSvgFactory = () => Promise<PdfToSvgModule>;

export interface PdfToSvgModule {
	FS: {
		writeFile(path: string, data: Uint8Array): void;

		readFile(
			path: string,
			options: {
				encoding: 'utf8';
			},
		): string;

		unlink(path: string): void;
	};

	_convertPdfToSvg(): number;
}

let wasmBytesPromise: Promise<Uint8Array> | undefined;

const PdfToSvgWasm: PdfToSvgFactory = async () => {
	wasmBytesPromise ??= decompressGzipBytes(pdfToSvgWasmGzipBase64).catch((error: unknown) => {
		wasmBytesPromise = undefined;
		throw error;
	});
	return createPdfToSvgModule({ wasmBinary: await wasmBytesPromise });
};

export default PdfToSvgWasm;
