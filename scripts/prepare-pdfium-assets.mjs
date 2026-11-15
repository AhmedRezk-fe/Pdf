import { cp, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const publicDir = join(root, 'public');
const paths = [
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ['node_modules/pdfjs-dist/cmaps', 'pdfjs/cmaps'],
  ['node_modules/pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['node_modules/pdfjs-dist/wasm', 'pdfjs/wasm'],
  ['node_modules/@embedpdf/pdfium/dist/pdfium.wasm', 'pdfium/pdfium.wasm'],
  ['node_modules/pdfcanvas/assets/fonts', 'fonts']
];
for (const [from, to] of paths) {
  const src = join(root, from);
  const dest = join(publicDir, to);
  await access(src); // Fail fast: no APK with missing PDFium engine assets.
  await mkdir(join(dest, '..'), { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log(`Prepared ${to}`);
}
