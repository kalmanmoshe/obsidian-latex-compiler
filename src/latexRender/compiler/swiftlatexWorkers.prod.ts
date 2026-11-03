import { pdftexWorkerBrotliBase64 } from '../../generated/pdftexWorker.payload';
import { xetexWorkerBrotliBase64 } from '../../generated/xetexWorker.payload';
import { dviWorkerBrotliBase64 } from '../../generated/dviWorker.payload';
import { decompressText } from 'src/util/decompressPayload';

async function createWorkerFromCompressedPayload(base64Payload: string, name: string): Promise<Worker> {
	const source = await decompressText(base64Payload);

	const sourceName = `latex-${name.toLowerCase()}-worker.js`;
	const namedSource = `${source}\n//# sourceURL=${sourceName}`;
	const blob = new Blob([namedSource], { type: 'text/javascript' });

	const url = URL.createObjectURL(blob);
	const worker = new Worker(url, { name: `Latex ${name} Engine` });

	window.setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 0);

	return worker;
}

export const pdftexWorkerFactory = async (): Promise<Worker> => {
	return createWorkerFromCompressedPayload(pdftexWorkerBrotliBase64, 'PDFTeX');
};

export const xetexWorkerFactory = async (): Promise<Worker> => {
	return createWorkerFromCompressedPayload(xetexWorkerBrotliBase64, 'XeTeX');
};

export const dviWorkerFactory = async (): Promise<Worker> => {
	return createWorkerFromCompressedPayload(dviWorkerBrotliBase64, 'DVI');
};
