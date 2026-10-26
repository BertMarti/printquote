// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import { pdfLabels } from '../src/pdf/labels';
import { startApp } from '../src/ui/app';
import { APP_VERSION } from '../src/version';

// Igual que en ui-fase2.test.ts: happy-dom no tiene WebGL, así que el visor es un doble.
vi.mock('../src/viewer/webgl', () => ({ supportsWebGL: () => true }));
vi.mock('../src/viewer/viewer', () => ({
  Viewer: class {
    setBed(): void {}
    setPart(): void {}
    setTheme(): void {}
    resetCamera(): void {}
    setAutoRotate(): void {}
    snapshot(): null {
      return null;
    }
  },
}));

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const html = readFileSync(join(root, 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

afterEach(() => {
  setLang('es');
  localStorage.clear();
});

describe('versión de la aplicación', () => {
  it('sale de package.json (una sola fuente) y es semver', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('el lockfile lleva la misma versión', () => {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
  });

  it('el pie del PDF la lleva en los dos idiomas', () => {
    expect(pdfLabels('es').footer).toBe(`Generado con printquote ${pkg.version} · bertmarti.github.io/printquote`);
    expect(pdfLabels('en').footer).toBe(`Created with printquote ${pkg.version} · bertmarti.github.io/printquote`);
  });

  it('el colofón del panel muestra la versión, la licencia y el enlace al código (noopener)', () => {
    document.body.innerHTML = body;
    startApp();
    const colophon = document.querySelector<HTMLElement>('.colophon');
    expect(colophon).not.toBeNull();
    expect(document.getElementById('app-version')?.textContent).toBe(pkg.version);
    expect(colophon?.textContent).toContain('licencia MIT');
    const link = colophon?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/BertMarti/printquote');
    expect(link?.getAttribute('rel')).toContain('noopener');
    setLang('en');
    expect(colophon?.getAttribute('aria-label')).toBe('About printquote');
    expect(link?.textContent).toBe('Source code, release notes and security reports');
  });
});
