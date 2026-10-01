import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFonts } from '../src/pdf/fonts';
import { fontResponse } from './helpers/fonts';

// `loadFonts` guarda su promesa en el módulo: cada archivo de pruebas parte de cero
// (el aviso de la interfaz, en pdf-fonts-error.test.ts).
describe('carga de las fuentes del PDF', () => {
  let online = false;
  let fontRequests = 0;

  beforeEach(() => {
    online = false;
    fontRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        fontRequests++;
        return online ? (fontResponse(url) as Response) : new Response('no', { status: 404 });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loadFonts guarda la promesa (una sola descarga) y la olvida si falla', async () => {
    const failure = await loadFonts().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe('FontLoadError');
    expect(fontRequests).toBe(4);

    online = true; // al reintentar se vuelve a descargar
    const first = loadFonts();
    expect(loadFonts()).toBe(first);
    await first;
    expect(fontRequests).toBe(8);

    await loadFonts(); // ya cargadas: sin más peticiones
    expect(fontRequests).toBe(8);
  });
});
