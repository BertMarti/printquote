import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServiceWorker, cacheVersion, precacheList, writeServiceWorker } from '../scripts/pwa-plugin';

/** Nombres tal como los deja `vite build` (con hash) más los de `public/`. */
const DIST = [
  'index.html',
  'favicon.svg',
  'manifest.webmanifest',
  'og.png',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/OFL-NotoSans.txt',
  'fonts/OFL-JetBrainsMono.txt',
  'samples/soporte-movil.stl',
  'assets/index-ft4MajcE.js',
  'assets/index-61kyimzU.css',
  'assets/stl.worker-BpDawJkE.js',
  'assets/viewer-DSGFQlA9.js',
  'assets/render-BdHjGyWW.js',
  'assets/NotoSans-Regular.subset-COoJkql3.ttf',
  'assets/JetBrainsMono-Bold.subset-DIDEoJmq.ttf',
];

describe('precaché del service worker', () => {
  it('incluye la app y el visor, y deja para la primera descarga el PDF, las fuentes, og.png y las licencias', () => {
    const list = precacheList(DIST);
    for (const wanted of ['index.html', 'assets/index-ft4MajcE.js', 'assets/index-61kyimzU.css', 'assets/stl.worker-BpDawJkE.js', 'assets/viewer-DSGFQlA9.js', 'samples/soporte-movil.stl', 'icons/icon-192.png', 'manifest.webmanifest', 'favicon.svg']) {
      expect(list, wanted).toContain(wanted);
    }
    for (const unwanted of ['assets/render-BdHjGyWW.js', 'assets/NotoSans-Regular.subset-COoJkql3.ttf', 'assets/JetBrainsMono-Bold.subset-DIDEoJmq.ttf', 'og.png', 'fonts/OFL-NotoSans.txt', 'sw.js']) {
      expect(list, unwanted).not.toContain(unwanted);
    }
  });

  it('sale ordenada y con barras normales aunque vengan de Windows', () => {
    const windows = (name: string): string => `assets${String.fromCharCode(92)}${name}`;
    const list = precacheList([windows('b.js'), windows('a.js'), 'index.html']);
    expect(list).toEqual(['assets/a.js', 'assets/b.js', 'index.html']);
  });
});

describe('versión de la caché', () => {
  const files = new Map([
    ['index.html', 'aaa'],
    ['assets/index-1.js', 'bbb'],
  ]);

  it('es la misma si no cambia nada (da igual el orden) y cambia si cambia un archivo, un nombre o un archivo nuevo', () => {
    const version = cacheVersion(files);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(cacheVersion(new Map([...files].reverse()))).toBe(version);
    expect(cacheVersion(new Map([...files, ['index.html', 'aab']]))).not.toBe(version);
    expect(cacheVersion(new Map([['index.html', 'aaa'], ['assets/index-2.js', 'bbb']]))).not.toBe(version);
    expect(cacheVersion(new Map([...files, ['extra.txt', 'c']]))).not.toBe(version);
  });
});

describe('escritura de sw.js', () => {
  const TEMPLATE = "const VERSION = '__VERSION__';\nconst PRECACHE = __PRECACHE__;\n";

  it('sustituye la versión y la lista en la plantilla', () => {
    const code = buildServiceWorker(TEMPLATE, ['index.html', 'assets/a.js'], 'abc123def456');
    expect(code).toBe("const VERSION = 'abc123def456';\nconst PRECACHE = [\"index.html\",\"assets/a.js\"];\n");
  });

  it('lee dist/, escribe dist/sw.js sin contarse a sí mismo y es reproducible', () => {
    const dist = mkdtempSync(join(tmpdir(), 'pq-dist-'));
    const put = (path: string, text: string): void => {
      mkdirSync(join(dist, path, '..'), { recursive: true });
      writeFileSync(join(dist, path), text);
    };
    put('index.html', '<html>');
    put('assets/index-1.js', 'x');
    put('assets/render-2.js', 'pdf');
    put('og.png', 'png');
    const template = join(dist, '..', `pq-template-${Date.now()}.js`);
    writeFileSync(template, TEMPLATE);

    const first = writeServiceWorker(dist, template);
    const code = readFileSync(join(dist, 'sw.js'), 'utf8');
    expect(code).toContain(`'${first.version}'`);
    expect(first.precache).toEqual(['assets/index-1.js', 'index.html']);

    expect(writeServiceWorker(dist, template).version).toBe(first.version); // el sw.js anterior no cuenta
    put('assets/index-1.js', 'y');
    expect(writeServiceWorker(dist, template).version).not.toBe(first.version);
  });

  it('la versión también cambia si cambia el propio service worker aunque la app sea la misma', () => {
    const dist = mkdtempSync(join(tmpdir(), 'pq-dist-'));
    writeFileSync(join(dist, 'index.html'), '<html>');
    const template = join(dist, '..', `pq-template-${Date.now()}-b.js`);
    writeFileSync(template, TEMPLATE);
    const before = writeServiceWorker(dist, template).version;
    writeFileSync(template, `${TEMPLATE}// otra lógica
`);
    expect(writeServiceWorker(dist, template).version).not.toBe(before);
  });
});
