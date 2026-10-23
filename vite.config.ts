import { defineConfig } from 'vitest/config';
import { csp } from './scripts/csp-plugin';
import { pwa } from './scripts/pwa-plugin';

// La web se publica en GitHub Pages bajo /printquote/. Se usa la misma base en
// desarrollo, build y preview para que las rutas se comporten igual en todas partes.
export default defineConfig({
  base: '/printquote/',
  plugins: [csp(), pwa()],
  build: {
    target: 'es2022',
    // Dos chunks pesados y esperados, ambos con import(): el visor (three.js, ~560 kB) tras pintar la
    // interfaz, y el PDF (pdf-lib + fontkit, ~1,1 MB) solo al pulsar «Descargar PDF».
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    // La Raspberry Pi y los ejecutores de Windows del CI van justos: 5 s daba falsos fallos por tiempo.
    testTimeout: 30_000,
  },
});
