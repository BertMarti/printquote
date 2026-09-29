import { defineConfig } from 'vitest/config';

// La web se publica en GitHub Pages bajo /printquote/. Se usa la misma base en
// desarrollo, build y preview para que las rutas se comporten igual en todas partes.
export default defineConfig({
  base: '/printquote/',
  build: {
    target: 'es2022',
    // three.js pesa ~550 kB sin comprimir; es esperado.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
