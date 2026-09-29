import { defineConfig } from 'vitest/config';

// En GitHub Pages la web vive en /printquote/. En local se sirve desde la raíz.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/printquote/' : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
