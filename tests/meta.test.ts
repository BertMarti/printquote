import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const html = readFileSync(join(root, 'index.html'), 'utf8');
const PAGES_URL = 'https://bertmarti.github.io/printquote/';

function meta(attr: 'name' | 'property', key: string): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]*\\b${attr}="${key}"[^>]*\\bcontent="([^"]*)"`));
  return tag?.[1];
}

describe('metadatos de la página', () => {
  it('idioma, título y descripción', () => {
    expect(html).toMatch(/<html lang="es">/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(meta('name', 'description')?.length).toBeGreaterThan(50);
  });

  it('Open Graph y tarjeta de Twitter completos, con URL absolutas', () => {
    for (const key of ['og:title', 'og:description', 'og:type', 'og:url', 'og:image', 'og:image:alt', 'og:locale']) {
      expect(meta('property', key), key).toBeTruthy();
    }
    expect(meta('property', 'og:url')).toBe(PAGES_URL);
    expect(meta('property', 'og:image')).toMatch(new RegExp(`^${PAGES_URL}`));
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
    for (const key of ['twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) {
      expect(meta('name', key), key).toBeTruthy();
    }
    expect(meta('name', 'twitter:image')).toBe(meta('property', 'og:image'));
  });

  it('la imagen de Open Graph existe en public/', () => {
    const image = meta('property', 'og:image') ?? '';
    expect(existsSync(join(root, 'public', image.replace(PAGES_URL, '')))).toBe(true);
  });

  it('favicon SVG minimalista con el cuadrado naranja', () => {
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
    const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8');
    expect(svg).toMatch(/#ff5a1f/i);
    expect(svg.length).toBeLessThan(600);
  });
});
