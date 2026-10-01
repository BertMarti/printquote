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

/** No se pudieron descargar las fuentes (sin conexión, 404…). La interfaz lo distingue por `name`. */
export class FontLoadError extends Error {
  override readonly name = 'FontLoadError';
}

async function get(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

let loading: Promise<FontBytes> | null = null;

/** Descarga las fuentes una sola vez por sesión; si falla, se olvida para poder reintentar. */
export function loadFonts(): Promise<FontBytes> {
  loading ??= download().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function download(): Promise<FontBytes> {
  try {
    return await fetchAll();
  } catch (error) {
    throw new FontLoadError(`No se han podido descargar las fuentes del PDF: ${String(error)}`, { cause: error });
  }
}

async function fetchAll(): Promise<FontBytes> {
  const [sans, bold, mono, monoBold] = await Promise.all([
    get(new URL('./fonts/NotoSans-Regular.subset.ttf', import.meta.url)),
    get(new URL('./fonts/NotoSans-Bold.subset.ttf', import.meta.url)),
    get(new URL('./fonts/JetBrainsMono-Regular.subset.ttf', import.meta.url)),
    get(new URL('./fonts/JetBrainsMono-Bold.subset.ttf', import.meta.url)),
  ]);
  return { sans, bold, mono, monoBold };
}
