import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { isValidLogo } from '../src/quote/business';
import { isSafePng, pngSize } from '../src/quote/png';

/** Cabecera de un PNG (firma + IHDR) con las medidas que se pidan, más unos bytes de relleno: no hace falta que se pueda pintar. */
function pngHeader(width: number, height: number): string {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt8(8, 24); // profundidad
  bytes.writeUInt8(6, 25); // RGBA
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

describe('medidas de un PNG sin descodificarlo (bomba de descompresión en el logotipo)', () => {
  it('lee el ancho y el alto de la cabecera IHDR', () => {
    expect(pngSize(PNG_1X1)).toEqual({ width: 1, height: 1 });
    expect(pngSize(pngHeader(400, 120))).toEqual({ width: 400, height: 120 });
    expect(pngSize(pngHeader(0xffffffff, 2))).toEqual({ width: 0xffffffff, height: 2 });
  });

  it('no es PNG o está cortado: null', () => {
    expect(pngSize('data:image/png;base64,AAAA')).toBeNull();
    expect(pngSize('data:image/png;base64,' + Buffer.from('GIF89a................................').toString('base64'))).toBeNull();
    expect(pngSize('data:image/jpeg;base64,/9j/4AAQ')).toBeNull();
    expect(pngSize('data:image/png;base64,!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!')).toBeNull();
  });

  it('acepta logotipos normales y rechaza medidas enormes o nulas', () => {
    expect(isSafePng(PNG_1X1)).toBe(true);
    expect(isSafePng(pngHeader(400, 400))).toBe(true);
    expect(isSafePng(pngHeader(4096, 4096))).toBe(true);
    expect(isSafePng(pngHeader(4097, 4096))).toBe(false);
    expect(isSafePng(pngHeader(8192, 1))).toBe(true);
    expect(isSafePng(pngHeader(8193, 1))).toBe(false);
    expect(isSafePng(pngHeader(60_000, 60_000))).toBe(false);
    expect(isSafePng(pngHeader(0, 10))).toBe(false);
    expect(isSafePng('data:image/png;base64,AAAA')).toBe(false);
    // Un JPEG no se descomprime al incrustarlo en el PDF: no se juzga aquí.
    expect(isSafePng('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
  });

  it('un logotipo PNG con medidas enormes no se acepta (ni de localStorage ni de un archivo importado)', () => {
    expect(isValidLogo(pngHeader(400, 400))).toBe(true);
    expect(isValidLogo(pngHeader(50_000, 50_000))).toBe(false);
  });
});
