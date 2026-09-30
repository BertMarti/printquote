import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FontBytes } from '../../src/pdf/fonts';

const read = (file: string): Uint8Array => new Uint8Array(readFileSync(join(process.cwd(), 'src/pdf/fonts', file)));

/** Las fuentes del PDF leídas del disco (en el navegador se piden con `fetch`). */
export const testFonts: FontBytes = {
  sans: read('NotoSans-Regular.subset.ttf'),
  bold: read('NotoSans-Bold.subset.ttf'),
  mono: read('JetBrainsMono-Regular.subset.ttf'),
  monoBold: read('JetBrainsMono-Bold.subset.ttf'),
};

/** Respuesta de `fetch` para el archivo de fuente que se pide (las pruebas de interfaz simulan `fetch`). */
export function fontResponse(url: unknown): Response | null {
  const file = String(url);
  return file.endsWith('.ttf') ? new Response(read(file.slice(file.lastIndexOf('/') + 1)).slice()) : null;
}
