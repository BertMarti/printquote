// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectLang, getLang, getLocale, isLang, onLangChange, setLang, t, tIn } from '../src/i18n';
import { applyStaticTranslations } from '../src/i18n/dom';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { interpolate } from '../src/i18n/interpolate';
import { formatDuration, formatEuro, formatNumber } from '../src/quote/format';

const root = process.cwd();
const html = readFileSync(join(root, 'index.html'), 'utf8');
const esKeys = Object.keys(es).sort();
const enKeys = Object.keys(en).sort();

afterEach(() => setLang('es'));

function placeholders(text: string): string[] {
  return Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1] ?? '').sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('diccionarios', () => {
  it('el inglés tiene exactamente las mismas claves que el español (falla si falta una en cualquier idioma)', () => {
    const missingInEnglish = esKeys.filter((key) => !(key in en));
    const missingInSpanish = enKeys.filter((key) => !(key in es));
    expect(missingInEnglish, 'faltan en en.ts').toEqual([]);
    expect(missingInSpanish, 'faltan en es.ts').toEqual([]);
    expect(enKeys).toEqual(esKeys);
  });

  it('ningún texto está vacío', () => {
    for (const [lang, dictionary] of [['es', es], ['en', en]] as const) {
      for (const [key, text] of Object.entries(dictionary)) {
        expect(text.trim(), `${lang}:${key}`).not.toBe('');
      }
    }
  });

  it('cada clave usa los mismos {marcadores} en los dos idiomas', () => {
    for (const key of esKeys) {
      const spanish = es[key as keyof typeof es];
      const english = en[key as keyof typeof en];
      expect(placeholders(english), key).toEqual(placeholders(spanish));
    }
  });

  it('el inglés no es una copia del español en los textos largos', () => {
    // Las frases de más de 40 caracteres idénticas en los dos idiomas son casi seguro un olvido.
    const same = esKeys.filter((key) => {
      const spanish = es[key as keyof typeof es];
      return spanish.length > 40 && spanish === en[key as keyof typeof en];
    });
    expect(same).toEqual([]);
  });

  it('todas las claves se usan en algún sitio (sin textos huérfanos)', () => {
    const source = sourceFiles(join(root, 'src')).map((file) => readFileSync(file, 'utf8')).join('\n') + html;
    // `format.${formato}` se compone en tiempo de ejecución.
    const dynamic = ['format.'];
    const orphans = esKeys.filter(
      (key) => !dynamic.some((prefix) => key.startsWith(prefix)) && !source.includes(`'${key}'`) && !source.includes(`"${key}"`),
    );
    expect(orphans).toEqual([]);
  });

  it('todas las claves que pide el código existen', () => {
    const source = sourceFiles(join(root, 'src'))
      .filter((file) => !file.includes(join('src', 'i18n')))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const used = new Set<string>();
    for (const match of source.matchAll(/\b(?:t|tIn)\((?:[a-z]+, )?'([\w.]+)'/g)) used.add(match[1] ?? '');
    for (const match of source.matchAll(/'((?:err|printer\.note|biz\.logo|pdf|copy|load)\.[\w.]+)'/g)) used.add(match[1] ?? '');
    for (const key of used) expect(esKeys, key).toContain(key);
  });
});

describe('HTML estático', () => {
  document.head.innerHTML = html.match(/<head>([\s\S]*)<\/head>/)?.[1] ?? '';
  document.body.innerHTML = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

  it('cada data-i18n / data-i18n-attr apunta a una clave que existe', () => {
    for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      expect(esKeys, node.outerHTML.slice(0, 80)).toContain(node.dataset['i18n']);
    }
    for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
      for (const pair of (node.dataset['i18nAttr'] ?? '').split(';')) {
        expect(esKeys, pair).toContain(pair.split(':')[1]?.trim());
      }
    }
  });

  it('el texto en español del HTML coincide con el diccionario (no se desvían)', () => {
    for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = node.dataset['i18n'] as keyof typeof es;
      expect((node.textContent ?? '').trim(), key).toBe(es[key]);
    }
    for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
      for (const pair of (node.dataset['i18nAttr'] ?? '').split(';')) {
        const [attribute, key] = pair.split(':').map((part) => part.trim());
        if (attribute && key && node.hasAttribute(attribute)) {
          expect(node.getAttribute(attribute), key).toBe(es[key as keyof typeof es]);
        }
      }
    }
  });

  it('traducir el HTML al inglés sustituye textos y atributos, y volver al español lo deja igual', () => {
    const before = document.body.innerHTML;
    setLang('en');
    applyStaticTranslations();
    expect(document.getElementById('open-button')?.textContent).toBe('Open 3D model');
    expect(document.querySelector('label[for="in-printer"]')?.textContent).toBe('Printer');
    expect(document.getElementById('panel')?.getAttribute('aria-label')).toBe('Data sheet and quote');
    expect(document.querySelector('label[for="in-price"]')?.textContent).toBe('Material price in euros per kilogram');
    setLang('es');
    applyStaticTranslations();
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('metadatos de la cabecera al cambiar de idioma', () => {
  const content = (selector: string): string | null => document.head.querySelector(selector)?.getAttribute('content') ?? null;
  const metas = [
    'meta[name="description"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="og:image:alt"]',
    'meta[property="og:locale"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]',
    'meta[name="twitter:image:alt"]',
  ];

  it('description, Open Graph y Twitter salen de los diccionarios en cada idioma', () => {
    for (const lang of ['en', 'es'] as const) {
      setLang(lang);
      applyStaticTranslations();
      expect(content('meta[name="description"]')).toBe(tIn(lang, 'meta.description'));
      expect(content('meta[property="og:title"]')).toBe(tIn(lang, 'meta.title'));
      expect(content('meta[name="twitter:title"]')).toBe(tIn(lang, 'meta.title'));
      expect(content('meta[property="og:description"]')).toBe(tIn(lang, 'meta.description'));
      expect(content('meta[name="twitter:description"]')).toBe(tIn(lang, 'meta.description'));
      expect(content('meta[property="og:image:alt"]')).toBe(tIn(lang, 'meta.ogImageAlt'));
      expect(content('meta[name="twitter:image:alt"]')).toBe(tIn(lang, 'meta.ogImageAlt'));
      expect(content('meta[property="og:locale"]')).toBe(lang === 'es' ? 'es_ES' : 'en_GB');
    }
  });

  it('en inglés no queda ninguna metaetiqueta de texto en español', () => {
    setLang('en');
    applyStaticTranslations();
    for (const selector of metas) expect(content(selector), selector).toBeTruthy();
    for (const selector of metas.filter((m) => !m.includes('locale'))) {
      expect(content(selector), selector).not.toMatch(/Arrastra|presupuesto|Interfaz de/);
    }
  });
});

describe('traducir', () => {
  it('sustituye marcadores y deja intactos los que faltan', () => {
    expect(interpolate('Hola {name}, tienes {n}', { name: 'Ana', n: 3 })).toBe('Hola Ana, tienes 3');
    expect(interpolate('Hola {name}', {})).toBe('Hola {name}');
    expect(interpolate('sin marcadores')).toBe('sin marcadores');
    expect(t('load.done', { name: 'a.stl' })).toBe('Pieza cargada: a.stl.');
    expect(tIn('en', 'load.done', { name: 'a.stl' })).toBe('Part loaded: a.stl.');
  });

  it('setLang cambia el idioma activo y avisa a quien escucha (una sola vez por cambio)', () => {
    const seen: string[] = [];
    const off = onLangChange((lang) => seen.push(lang));
    setLang('en');
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('action.copy')).toBe('Copy quote');
    setLang('es');
    off();
    setLang('en');
    expect(seen).toEqual(['en', 'es']);
  });

  it('isLang solo acepta es y en', () => {
    expect([isLang('es'), isLang('en'), isLang('fr'), isLang(null)]).toEqual([true, true, false, false]);
  });
});

describe('idioma inicial', () => {
  it('usa el guardado si es válido', () => {
    expect(detectLang(['es-ES'], 'en')).toBe('en');
    expect(detectLang(['en-US'], 'es')).toBe('es');
  });

  it('ignora un valor guardado que no es un idioma y mira el navegador', () => {
    expect(detectLang(['en-GB'], 'fr')).toBe('en');
    expect(detectLang(['es-MX'], null)).toBe('es');
    expect(detectLang(['ES_es'])).toBe('es');
  });

  it('toma el primer idioma del navegador que sea español o inglés', () => {
    expect(detectLang(['fr-FR', 'en-US', 'es-ES'])).toBe('en');
    expect(detectLang(['ca-ES', 'es'])).toBe('es');
  });

  it('si no hay ninguno de los dos, inglés; si el navegador no dice nada, español', () => {
    expect(detectLang(['fr-FR', 'de'])).toBe('en');
    expect(detectLang([])).toBe('es');
  });
});

describe('formato por idioma', () => {
  it('español: coma decimal y euro detrás', () => {
    expect(getLocale()).toBe('es-ES');
    expect(formatNumber(1234.5, 2)).toBe('1234,50');
    expect(formatEuro(12.34)).toMatch(/^12,34\s€$/);
  });

  it('inglés: punto decimal, coma de miles y euro delante', () => {
    setLang('en');
    expect(getLocale()).toBe('en-GB');
    expect(formatNumber(1234.5, 2)).toBe('1,234.50');
    expect(formatNumber(0.45, 2)).toBe('0.45');
    expect(formatEuro(12.34)).toBe('€12.34');
    expect(formatEuro(1234.5)).toBe('€1,234.50');
    expect(formatDuration(2.0833)).toBe('2 h 05 min');
  });

  it('no arrastra formatos guardados de un idioma al otro', () => {
    setLang('en');
    expect(formatNumber(1.5, 1)).toBe('1.5');
    setLang('es');
    expect(formatNumber(1.5, 1)).toBe('1,5');
  });
});
