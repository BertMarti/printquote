import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const BASE = '/printquote/';
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  lang: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};
const html = readFileSync(join(root, 'index.html'), 'utf8');

/** Ancho y alto de un PNG, de su cabecera IHDR. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('manifiesto de la PWA', () => {
  it('es instalable: nombre, modo independiente y scope bajo /printquote/', () => {
    expect(manifest.name).toBe('printquote');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe(BASE);
    expect(manifest.scope).toBe(BASE);
    expect(manifest.lang).toBe('es');
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('declara iconos de 192 y 512 y uno maskable, y cada archivo existe con la medida que dice', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512')).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith(BASE), icon.src).toBe(true);
      expect(icon.type).toBe('image/png');
      const file = join(root, 'public', icon.src.slice(BASE.length));
      expect(existsSync(file), icon.src).toBe(true);
      const [width, height] = pngSize(file);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it('index.html enlaza el manifiesto y el icono de iOS, y este existe (180 × 180)', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    const apple = html.match(/<link rel="apple-touch-icon" href="\/([^"]+)"/)?.[1];
    expect(apple).toBeTruthy();
    expect(pngSize(join(root, 'public', apple ?? ''))).toEqual([180, 180]);
  });
});
