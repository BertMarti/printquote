// Plugin de Vite para la PWA, sin dependencias: tras compilar, escribe `dist/sw.js` a partir de
// `src/sw.js` con la lista de archivos que se precachean y una versión de caché.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Lo que NO se precachea: se guarda en caché la primera vez que se pide (el service worker lo hace solo).
 * El chunk del PDF (pdf-lib + fontkit, ~1,1 MB) y las fuentes casi nadie los necesita en la primera visita;
 * `og.png` y las licencias no hacen falta para usar la app.
 */
const LAZY = [/^assets\/render-[^/]*\.js$/, /^assets\/[^/]*\.ttf$/, /^og\.png$/, /^fonts\//, /^sw\.js$/];

const BACKSLASH = String.fromCharCode(92);
/** Rutas siempre con «/», vengan de Windows o no. */
const toPosix = (path: string): string => path.split(BACKSLASH).join('/');

/** Archivos de `dist/` (rutas con «/») que se descargan al instalar el service worker. */
export function precacheList(files: readonly string[]): string[] {
  return files
    .map(toPosix)
    .filter((file) => !LAZY.some((pattern) => pattern.test(file)))
    .sort();
}

/** Versión de la caché: cambia si cambia el nombre o el contenido de cualquier archivo (`ruta → hash`). */
export function cacheVersion(files: ReadonlyMap<string, string>): string {
  const lines = [...files].map(([path, hash]) => `${path}\t${hash}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12);
}

/** Rellena la plantilla del service worker. */
export function buildServiceWorker(template: string, precache: readonly string[], version: string): string {
  return template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Lee `dist/`, escribe `dist/sw.js` y devuelve lo que ha puesto. El `sw.js` anterior no cuenta. */
export function writeServiceWorker(dist: string, templatePath: string): { version: string; precache: string[] } {
  const hashes = new Map<string, string>();
  for (const file of walk(dist)) {
    const path = toPosix(relative(dist, file));
    if (path === 'sw.js') continue;
    hashes.set(path, createHash('sha256').update(readFileSync(file)).digest('hex'));
  }
  const template = readFileSync(templatePath, 'utf8');
  const precache = precacheList([...hashes.keys()]);
  // La lógica del propio service worker también cuenta: si cambia, cambia la versión aunque la app no.
  hashes.set('(service worker)', createHash('sha256').update(template).digest('hex'));
  const version = cacheVersion(hashes);
  writeFileSync(join(dist, 'sw.js'), buildServiceWorker(template, precache, version));
  return { version, precache };
}

export function pwa(): Plugin {
  let root = process.cwd();
  let dist = 'dist';
  return {
    name: 'printquote-pwa',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      dist = join(root, config.build.outDir);
    },
    // `closeBundle`: ya están escritos los archivos compilados y los de `public/`.
    closeBundle() {
      const { version, precache } = writeServiceWorker(dist, join(root, 'src', 'sw.js'));
      console.log(`sw.js: ${precache.length} archivos en el precaché, versión ${version}`);
    },
  };
}
