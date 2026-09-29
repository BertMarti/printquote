import { defineConfig } from 'vitest/config';

// La web se publica en GitHub Pages bajo /printquote/. Se usa la misma base en
// desarrollo, build y preview para que las rutas se comporten igual en todas partes.
export default defineConfig({
  base: '/printquote/',
  build: {
    target: 'es2022',
    // El chunk del visor (three.js) pesa ~560 kB sin comprimir; es esperado. Se carga
    // con import() después de pintar la interfaz, así que no retrasa el primer render.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
