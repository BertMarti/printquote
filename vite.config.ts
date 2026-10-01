import { defineConfig } from 'vitest/config';
import { pwa } from './scripts/pwa-plugin';

// La web se publica en GitHub Pages bajo /printquote/. Se usa la misma base en
// desarrollo, build y preview para que las rutas se comporten igual en todas partes.
export default defineConfig({
  base: '/printquote/',
  plugins: [pwa()],
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
  },
});
