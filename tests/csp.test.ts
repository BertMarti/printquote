import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP, csp, injectCsp } from '../scripts/csp-plugin';
import { TRUSTED_TYPES_POLICY } from '../src/trusted-types';

const HTML = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>printquote</title>
    <script type="module" src="/src/main.ts"></script>
  </head>
  <body></body>
</html>`;

const META = '<meta http-equiv="Content-Security-Policy" content=';
const INJECTED = /\n\s*<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/;

const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('injectCsp', () => {
  it('mete el <meta> de la CSP justo después de <meta charset> y antes de cualquier link o script', () => {
    const out = injectCsp(HTML);
    expect(out).toMatch(/<meta charset="utf-8" \/>\s*<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/);
    expect(count(out, '<meta charset')).toBe(1);
    expect(count(out, META)).toBe(1);

    const cspAt = out.indexOf(META);
    expect(cspAt).toBeGreaterThan(out.indexOf('<meta charset'));
    expect(cspAt).toBeLessThan(out.indexOf('<link'));
    expect(cspAt).toBeLessThan(out.indexOf('<script'));
  });

  it('solo añade el <meta>: el resto del documento queda intacto y con la política CSP', () => {
    const out = injectCsp(HTML);
    expect(out).toContain(`content="${CSP}"`);
    expect(out.replace(INJECTED, '')).toBe(HTML);
  });

  it('lanza un Error si el HTML no lleva <meta charset> (no sabe dónde ponerla)', () => {
    expect(() => injectCsp('<html><head><title>sin charset</title></head><body></body></html>')).toThrow(Error);
    expect(() => injectCsp('')).toThrow(/meta charset/);
  });
});

describe('la política', () => {
  const directive = (name: string): string =>
    CSP.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? '';

  it('no permite scripts en línea ni eval', () => {
    expect(CSP).not.toContain('unsafe-inline');
    expect(CSP).not.toContain('unsafe-eval');
    expect(directive('script-src')).toBe("script-src 'self'");
  });

  it('saca del propio sitio los workers y las imágenes, y prohíbe los objetos incrustados', () => {
    expect(directive('worker-src')).toBe("worker-src 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('img-src')).toContain('data:');
    expect(directive('img-src')).toContain('blob:');
  });
});

describe('Trusted Types', () => {
  const directive = (name: string): string =>
    CSP.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? '';

  it('exige Trusted Types para los scripts y solo permite la política de la app, sin duplicados', () => {
    expect(directive('require-trusted-types-for')).toBe("require-trusted-types-for 'script'");
    expect(directive('trusted-types')).toBe(`trusted-types ${TRUSTED_TYPES_POLICY}`);
    expect(CSP).not.toContain('allow-duplicates');
    expect(directive('trusted-types')).not.toContain("'none'");
    expect(directive('trusted-types')).not.toContain('default');
  });
});

describe('el plugin csp()', () => {
  it('solo actúa al compilar y su transformación añade la política', () => {
    const plugin = csp();
    expect(plugin.apply).toBe('build');
    expect(typeof plugin.transformIndexHtml).toBe('function');
    const transform = plugin.transformIndexHtml as unknown as (html: string) => string;
    expect(transform(HTML)).toContain(META);
  });
});

describe('index.html real', () => {
  it('acepta la inyección y la CSP va antes del primer recurso', () => {
    const out = injectCsp(indexHtml);
    const cspAt = out.indexOf(META);
    expect(cspAt).toBeGreaterThan(out.indexOf('<meta charset'));
    expect(cspAt).toBeLessThan(out.indexOf('<link'));
    expect(out).toContain(`content="${CSP}"`);
  });

  it('no rompe la política: todos los scripts llevan src y no hay on*= ni style= en línea', () => {
    const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1] ?? '');
    expect(scripts.length).toBeGreaterThan(0);
    for (const attrs of scripts) expect(attrs).toMatch(/\bsrc\s*=/);

    expect(indexHtml).not.toMatch(/\son[a-z]+\s*=/i);
    expect(indexHtml).not.toMatch(/\sstyle\s*=/i);
  });
});
