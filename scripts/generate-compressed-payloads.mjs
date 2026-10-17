import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

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
  const version = name === 'pdfToSvgWasm' ? 2 : 1;
  const header = `// Payload generator v${version}; source SHA-256: ${hash}\n`;
  if (ifNeeded) {
    let file;
    try {
      file = await open(target, 'r');
      const buffer = Buffer.alloc(Buffer.byteLength(header));
      await file.read(buffer, 0, buffer.length, 0);
      const runtimeExists = name !== 'pdfToSvgWasm' || await readFile(new URL('pdfToSvgRuntime.js', output)).then(() => true, error => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (buffer.toString() === header && runtimeExists) {
        console.log(`Unchanged ${name}.payload.ts`);
        continue;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      await file?.close();
    }
  }
  let payloadBytes = bytes;
  if (name === 'pdfToSvgWasm') {
    const sourceText = bytes.toString('utf8');
    const ast = ts.createSourceFile(source, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const calls = [];
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'binaryDecode'
          && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) calls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (calls.length !== 1) throw new Error('Expected exactly one embedded PDF-to-SVG WASM binary.');
    const call = calls[0];
    // Match Emscripten's binaryDecode, including its non-ASCII byte encoding.
    payloadBytes = Uint8Array.from(call.arguments[0].text, c => (~c.charCodeAt(0) >> 8) & c.charCodeAt(0));
    if (!WebAssembly.validate(payloadBytes)) throw new Error('Extracted PDF-to-SVG WASM is invalid.');
    const wrapper = sourceText.slice(0, call.getStart(ast)) + 'Module["wasmBinary"]' + sourceText.slice(call.end);
    await writeFile(new URL('pdfToSvgRuntime.js', output), wrapper);
  }
  const payload = gzipSync(payloadBytes, { level: 9 }).toString('base64');
  await writeFile(target,
    `${header}// Generated from ${source}. Regenerate with npm run generate:payloads.\nexport const ${exportName} = "${payload}";\n`);
  console.log(`Generated ${name}.payload.ts`);
}
