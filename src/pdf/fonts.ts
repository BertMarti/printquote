/**
 * Fuentes del PDF (Noto Sans y JetBrains Mono, licencia OFL; ver `fonts/LEEME.txt`). Son archivos
 * aparte: Vite los emite como recursos y solo se piden al pulsar «Descargar PDF».
 */
export interface FontBytes {
  readonly sans: Uint8Array;
  readonly bold: Uint8Array;
  readonly mono: Uint8Array;
  readonly monoBold: Uint8Array;
}

async function get(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo cargar la fuente ${url.pathname} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadFonts(): Promise<FontBytes> {
  const [sans, bold, mono, monoBold] = await Promise.all([
    get(new URL('./fonts/NotoSans-Regular.subset.ttf', import.meta.url)),
    get(new URL('./fonts/NotoSans-Bold.subset.ttf', import.meta.url)),
    get(new URL('./fonts/JetBrainsMono-Regular.subset.ttf', import.meta.url)),
    get(new URL('./fonts/JetBrainsMono-Bold.subset.ttf', import.meta.url)),
  ]);
  return { sans, bold, mono, monoBold };
}
