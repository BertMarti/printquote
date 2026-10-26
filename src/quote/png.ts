/**
 * Medidas de un PNG en `data:` sin descodificarlo. pdf-lib descomprime los PNG enteros al incrustarlos
 * (los JPEG los copia tal cual), así que un PNG pequeño con medidas enormes («bomba de descompresión»)
 * podría agotar la memoria de la pestaña al generar el PDF. El logotipo puede llegar de un archivo de
 * ajustes importado o de `localStorage` (origen compartido): no es fiable.
 */

/** Máximo de píxeles de un PNG que se acepta (4096 × 4096). El logotipo se guarda a 400 px como mucho. */
export const PNG_MAX_PIXELS = 4096 * 4096;
/** Máximo de un lado, por si el otro es de 1 px. */
export const PNG_MAX_SIDE = 8192;

const PNG_PREFIX = 'data:image/png;base64,';

/** Ancho y alto de la cabecera IHDR, o `null` si no es un PNG que se pueda leer. */
export function pngSize(dataUrl: string): { width: number; height: number } | null {
  if (!dataUrl.startsWith(PNG_PREFIX)) return null;
  // Firma (8 bytes) + longitud y tipo de IHDR (8) + ancho y alto (8) = 24 bytes = 32 caracteres en base64.
  const head = dataUrl.slice(PNG_PREFIX.length, PNG_PREFIX.length + 32);
  if (head.length < 32) return null;
  let bytes: string;
  try {
    bytes = atob(head);
  } catch {
    return null;
  }
  const byte = (i: number): number => bytes.charCodeAt(i);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((value, i) => byte(i) !== value)) return null;
  if (bytes.slice(12, 16) !== 'IHDR') return null;
  const u32 = (i: number): number => ((byte(i) << 24) >>> 0) + (byte(i + 1) << 16) + (byte(i + 2) << 8) + byte(i + 3);
  return { width: u32(16), height: u32(20) };
}

/** ¿Es un PNG con medidas que se pueden descomprimir sin riesgo? (Lo que no es PNG no se juzga aquí.) */
export function isSafePng(dataUrl: string): boolean {
  if (!dataUrl.startsWith(PNG_PREFIX)) return true;
  const size = pngSize(dataUrl);
  if (!size) return false;
  const { width, height } = size;
  return width > 0 && height > 0 && width <= PNG_MAX_SIDE && height <= PNG_MAX_SIDE && width * height <= PNG_MAX_PIXELS;
}
