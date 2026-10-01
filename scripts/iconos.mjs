// Genera los iconos PNG de la PWA a partir de public/favicon.svg con Chrome headless (sin dependencias).
//
// Uso: node scripts/iconos.mjs      (hace falta Chrome o Edge; CHROME=/ruta si no se encuentra)
//  →  public/icons/icon-192.png, icon-512.png, icon-maskable-512.png y apple-touch-icon.png (180)
//
// El icono «maskable» deja el motivo dentro del 80 % central (zona segura): el sistema lo recorta
// en círculo, cuadrado redondeado, etc. El resto es el favicon a todo el lienzo.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withChrome } from './chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8');
// El favicon es un cuadrado de fondo oscuro con un cuadrado naranja: se reutilizan sus dos colores.
const dark = svg.match(/<rect width="32" height="32" fill="(#[0-9a-f]{6})"/i)?.[1];
const accent = svg.match(/<rect x="7" y="7" width="18" height="18" fill="(#[0-9a-f]{6})"/i)?.[1];
if (!dark || !accent) throw new Error('public/favicon.svg ha cambiado: actualiza scripts/iconos.mjs');

const ICONS = [
  { file: 'icon-192.png', size: 192, safe: 1 },
  { file: 'icon-512.png', size: 512, safe: 1 },
  { file: 'icon-maskable-512.png', size: 512, safe: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, safe: 1 },
];

const page = ({ size, safe }) => {
  const inner = 32 * safe;
  const offset = (32 - inner) / 2;
  const mark = 18 * safe;
  const markOffset = offset + 7 * safe;
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${dark}}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" style="display:block">
<rect width="32" height="32" fill="${dark}"/><rect x="${markOffset}" y="${markOffset}" width="${mark}" height="${mark}" fill="${accent}"/></svg>`;
};

mkdirSync(join(root, 'public', 'icons'), { recursive: true });
await withChrome(async ({ send }) => {
  for (const icon of ICONS) {
    await send('Emulation.setDeviceMetricsOverride', { width: icon.size, height: icon.size, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(page(icon)).toString('base64')}` });
    await new Promise((done) => setTimeout(done, 300));
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, 'public', 'icons', icon.file), Buffer.from(data, 'base64'));
    console.log(`public/icons/${icon.file} (${icon.size} × ${icon.size})`);
  }
});
