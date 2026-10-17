import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const output = new URL('src/generated/', root);
const ifNeeded = process.argv.includes('--if-needed');
const artifacts = [
  ['src/latexRender/pdfConversion/pdfToSvgWasm.js', 'pdfToSvgWasm', 'pdfToSvgWasmGzipBase64'],
  ['src/latexRender/compiler/swiftlatexpdftex/swiftlatexpdftex.worker.js', 'pdftexWorker', 'pdftexWorkerGzipBase64'],
  ['src/latexRender/compiler/swiftlatexxetex/swiftlatexxetex.worker.js', 'xetexWorker', 'xetexWorkerGzipBase64'],
  ['src/latexRender/compiler/swiftlatexxetex/swiftlatexdvipdfm.worker.js', 'dviWorker', 'dviWorkerGzipBase64'],
];

await mkdir(output, { recursive: true });
for (const [source, name, exportName] of artifacts) {
  const bytes = await readFile(new URL(source, root));
  const target = new URL(`${name}.payload.ts`, output);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const header = `// Payload generator v1; source SHA-256: ${hash}\n`;
  if (ifNeeded) {
    let file;
    try {
      file = await open(target, 'r');
      const buffer = Buffer.alloc(Buffer.byteLength(header));
      await file.read(buffer, 0, buffer.length, 0);
      if (buffer.toString() === header) {
        console.log(`Unchanged ${name}.payload.ts`);
        continue;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      await file?.close();
    }
  }
  const payload = gzipSync(bytes, { level: 9 }).toString('base64');
  await writeFile(target,
    `${header}// Generated from ${source}. Regenerate with npm run generate:payloads.\nexport const ${exportName} = "${payload}";\n`);
  console.log(`Generated ${name}.payload.ts`);
}
