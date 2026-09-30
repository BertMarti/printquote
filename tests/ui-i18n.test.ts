// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, decodePDFRawStream, PDFRawStream } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import { buildQuoteDocument } from '../src/pdf/document';
import { pdfLabels } from '../src/pdf/labels';
import { renderQuotePdf } from '../src/pdf/render';
import { DEFAULT_BUSINESS } from '../src/quote/business';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { buildQuoteText } from '../src/quote/text';
import { computeStats } from '../src/stl/geometry';
import { startApp } from '../src/ui/app';
import { binaryStl, cubeTriangles, toPositions } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

function setNavigatorLanguages(languages: string[]): void {
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true });
  Object.defineProperty(navigator, 'language', { value: languages[0], configurable: true });
}

function click(lang: 'es' | 'en'): void {
  document.querySelector<HTMLButtonElement>(`button[data-lang="${lang}"]`)?.click();
}

describe('interfaz en inglés', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    document.body.innerHTML = body;
    document.documentElement.lang = 'es';
    document.head.innerHTML = '<meta name="description" content="" />';
    const stl = binaryStl(cubeTriangles(300)); // no cabe en la cama: hay un aviso
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
  });

  afterEach(() => {
    setNavigatorLanguages(['es-ES', 'es']);
    setLang('es');
    vi.unstubAllGlobals();
  });

  it('con el navegador en español arranca en español y <html lang> lo dice', () => {
    startApp();
    expect(document.documentElement.lang).toBe('es');
    expect($('open-button').textContent).toBe('Abrir modelo 3D');
    expect(document.querySelector('button[data-lang="es"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('con el navegador en inglés arranca en inglés: textos, <html lang>, título y descripción', () => {
    setNavigatorLanguages(['en-GB', 'en']);
    startApp();
    expect(document.documentElement.lang).toBe('en');
    expect($('open-button').textContent).toBe('Open 3D model');
    expect($('sample-button').textContent).toBe('Try the sample part');
    expect(document.querySelector('label[for="in-flow"]')?.textContent).toMatch(/^Volumetric flow/);
    expect($('out-summary').textContent).toBe('Load a part to calculate the quote.');
    expect($('file-name').textContent).toBe('No part loaded');
    expect(document.title).toBe('printquote · 3D print quote');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/^Drop an STL/);
    expect($<HTMLSelectElement>('in-printer').options[0]?.text).toBe('Custom');
    expect(document.querySelector('button[data-lang="en"]')?.getAttribute('aria-pressed')).toBe('true');
    expect($('stage-legend').textContent).toBe('Grid 10 mm · Bed 220 × 220 × 250 mm');
    // La densidad del material usa el punto decimal.
    expect(document.querySelector('[data-density="PLA"]')?.textContent).toBe('1.24');
    expect($<HTMLInputElement>('in-linewidth').value).toBe('0.45');
  });

  it('un idioma elegido a mano gana al del navegador y se recuerda al recargar', () => {
    setNavigatorLanguages(['es-ES']);
    startApp();
    click('en');
    expect(window.localStorage.getItem('printquote:idioma:v1')).toBe('en');
    document.body.innerHTML = body;
    startApp();
    expect(document.documentElement.lang).toBe('en');
    expect($('open-button').textContent).toBe('Open 3D model');
  });

  it('el selector cambia todo al vuelo: avisos, cifras, formato, campos y errores', async () => {
    startApp();
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
    expect($('warnings').textContent).toMatch(/no cabe en la cama/);
    expect($('file-detail').textContent).toMatch(/^STL binario · 12 triángulos/);
    const spanishTotal = $('out-total').textContent ?? '';
    expect(spanishTotal).toMatch(/€$/);

    click('en');
    expect(document.documentElement.lang).toBe('en');
    expect($('warnings').textContent).toMatch(/does not fit on the .* bed, even when rotated\.$/);
    expect($('file-detail').textContent).toMatch(/^Binary STL · 12 triangles/);
    expect($('out-total').textContent).toMatch(/^€/);
    expect($('out-total').textContent).not.toBe(spanishTotal);
    expect($('out-summary').textContent).toMatch(/\(estimate\)$/);
    expect($('out-weight-sub').textContent).toBe('total');
    expect($('copy-button').textContent).toBe('Copy quote');
    expect($('pdf-button').textContent).toBe('Download PDF');
    expect($<HTMLInputElement>('in-energy').value).toBe('0.15');

    // El mensaje de error de un campo sale en inglés.
    const margin = $<HTMLInputElement>('in-margin');
    margin.value = '99999';
    margin.dispatchEvent(new Event('input'));
    expect($('err-margin').textContent).toBe('Enter a number between 0 and 1000.');

    click('es');
    expect(document.documentElement.lang).toBe('es');
    expect($('warnings').textContent).toMatch(/no cabe en la cama/);
    expect($('out-total').textContent).toBe(spanishTotal);
    expect($<HTMLInputElement>('in-energy').value).toBe('0,15');
  });

  it('los errores de lectura se traducen y cambian con el idioma', async () => {
    setNavigatorLanguages(['en-US']);
    startApp();
    const input = $<HTMLInputElement>('file-input');
    Object.defineProperty(input, 'files', { value: [new File(['PK\u0003\u0004no es un zip'], 'roto.3mf')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => !$('notice').hidden);
    expect($('notice').textContent).toBe('“roto.3mf” could not be readThe file is not a valid ZIP (is it really a 3MF?).');
    click('es');
    expect($('notice').textContent).toBe('No se ha podido leer «roto.3mf»El archivo no es un ZIP válido (¿es realmente un 3MF?).');
  });

  it('el perfil de impresora y su nota salen en el idioma activo', () => {
    setNavigatorLanguages(['en-US']);
    startApp();
    const select = $<HTMLSelectElement>('in-printer');
    select.value = 'creality-k1';
    select.dispatchEvent(new Event('change'));
    expect($('printer-note').textContent).toMatch(/^Approximate starting values\. Build volume from the manufacturer/);
    click('es');
    expect($('printer-note').textContent).toMatch(/^Valores de partida orientativos\. Volumen de impresión/);
    expect(select.value).toBe('creality-k1');
  });

  it('el texto para copiar sale en inglés con fecha y números en inglés', () => {
    setLang('en');
    const stats = computeStats({ positions: toPositions(cubeTriangles(20)), triangleCount: 12, format: 'binary' });
    const quote = computeQuote(stats, DEFAULT_SETTINGS);
    const text = buildQuoteText({ fileName: 'cube.stl', stats, settings: DEFAULT_SETTINGS, quote, date: new Date(2026, 8, 30) });
    expect(text).toContain('3D PRINT QUOTE');
    expect(text).toContain('cube.stl · 30 September 2026');
    expect(text).toMatch(/Total weight\s+4\.1 g/);
    expect(text).toMatch(/TOTAL\s+€0\.10/);
    expect(text).toContain('The time is an estimate.');
  });
});

/** Textos de la primera página de un PDF (cadenas hexadecimales WinAnsi de pdf-lib). */
async function pdfTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(0).node.Contents();
  const refs = contents && 'asArray' in contents ? contents.asArray() : contents ? [contents] : [];
  const out: string[] = [];
  for (const ref of refs) {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const source = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
    for (const match of source.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      const hex = match[1] ?? '';
      let text = '';
      for (let i = 0; i < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      out.push(text.replace(/\u0080/g, '€'));
    }
  }
  return out;
}

describe('PDF en inglés', () => {
  afterEach(() => setLang('es'));

  it('etiquetas, fechas, números y moneda salen en inglés', async () => {
    setLang('en');
    const stats = computeStats({ positions: toPositions(cubeTriangles(20)), triangleCount: 12, format: 'binary' });
    const quote = computeQuote(stats, DEFAULT_SETTINGS);
    const doc = buildQuoteDocument({
      business: { ...DEFAULT_BUSINESS, name: 'Print Shop', taxId: 'GB123', quoteNumber: '2026-003' },
      fileName: 'cube.stl',
      stats,
      settings: DEFAULT_SETTINGS,
      quote,
      image: null,
      date: new Date(2026, 8, 30),
    });
    expect(doc.meta).toEqual([
      ['No.', '2026-003'],
      ['Date', '30 September 2026'],
      ['Valid until', '30 October 2026'],
    ]);
    expect(doc.totalRows).toEqual([
      ['Taxable amount', '€0.10'],
      ['VAT (21 %)', '€0.02'],
      ['Total incl. VAT', '€0.12'],
    ]);
    const texts = await pdfTexts(await renderQuotePdf(doc));
    for (const expected of ['Print Shop', 'QUOTE', 'TOTAL INCL. VAT', '€0.12', 'Taxable amount', 'Tax ID: GB123']) {
      expect(texts, expected).toContain(expected);
    }
  });

  it('pdfLabels tiene los mismos campos en los dos idiomas y ninguno vacío', () => {
    const spanish = pdfLabels('es');
    const english = pdfLabels('en');
    expect(Object.keys(english)).toEqual(Object.keys(spanish));
    for (const [key, value] of Object.entries(english)) expect(value, key).not.toBe('');
    expect(english.dateLocale).toBe('en-GB');
    expect(spanish.dateLocale).toBe('es-ES');
  });
});

describe('idioma en caliente: textos ocultos o para lectores de pantalla', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    document.body.innerHTML = body;
    document.head.innerHTML = '<meta name="description" content="" />';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(binaryStl(cubeTriangles(20)).slice(0))));
  });
  afterEach(() => {
    setNavigatorLanguages(['es-ES', 'es']);
    setLang('es');
    vi.unstubAllGlobals();
  });

  it('el indicador de lectura en curso se traduce si se cambia de idioma mientras se lee', async () => {
    startApp();
    $('sample-button').click();
    expect($('stage-loading').textContent).toBe('Leyendo «soporte-movil.stl»…');
    click('en');
    expect($('stage-loading').textContent).toBe('Reading “soporte-movil.stl”…');
    await until(() => $('out-total').textContent !== '—');
  });

  it('el último anuncio para lectores de pantalla no se queda en el idioma anterior', async () => {
    startApp();
    $('sample-button').click();
    await until(() => ($('live-status').textContent ?? '').startsWith('Pieza cargada'));
    click('en');
    expect($('live-status').textContent).toBe('');
  });
});
