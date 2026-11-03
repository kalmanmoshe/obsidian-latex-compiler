import initializeBrotli, { decompress as brotliDecompress } from 'brotli-dec-wasm/web';
import { brotliDecoderWasmGzipBase64 } from '../generated/brotliDecoderWasm.payload';

export function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

async function decompressGzipBuffer(base64: string): Promise<ArrayBuffer> {
	const compressed = decodeBase64(base64);

	if (typeof DecompressionStream === 'undefined') {
		throw new Error('DecompressionStream is not supported on this device.');
	}

	const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));

	return new Response(stream).arrayBuffer();
}

export async function decompressGzipText(base64: string): Promise<string> {
	const buffer = await decompressGzipBuffer(base64);
	return new TextDecoder().decode(buffer);
}

export async function decompressGzipBytes(base64: string): Promise<Uint8Array> {
	const buffer = await decompressGzipBuffer(base64);
	return new Uint8Array(buffer);
}

let decoderPromise: Promise<typeof brotliDecompress> | undefined;

function getBrotliDecoder(): Promise<typeof brotliDecompress> {
	decoderPromise ??= (async () => {
		const wasmBytes = await decompressGzipBytes(brotliDecoderWasmGzipBase64);
		// Explicit bytes keep wasm-bindgen's URL/fetch initialization path unused.
		await initializeBrotli({ module_or_path: wasmBytes });
		return brotliDecompress;
	})().catch((error: unknown) => {
		decoderPromise = undefined;
		throw new Error('Unable to initialize the Brotli payload decoder.', { cause: error });
	});
	return decoderPromise;
}

export async function decompressBytes(base64: string): Promise<Uint8Array> {
	const decode = await getBrotliDecoder();
	try {
		// The WASM call is synchronous: concurrent callers cannot overlap decoder access.
		// Return its output directly; do not make another copy of the worker/WASM bytes.
		return decode(decodeBase64(base64));
	} catch (error: unknown) {
		// An invalid payload must not evict the shared, successfully initialized decoder.
		throw new Error('Unable to decompress the Brotli payload.', { cause: error });
	}
}

export async function decompressText(base64: string): Promise<string> {
	return new TextDecoder().decode(await decompressBytes(base64));
}
