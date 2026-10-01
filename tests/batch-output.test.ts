import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n';
import { buildBatchDocument } from '../src/pdf/document';
import { renderQuotePdf } from '../src/pdf/render';
import { computeBatch, makePart, type BatchPart } from '../src/quote/batch';
import { DEFAULT_BUSINESS } from '../src/quote/business';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeTax } from '../src/quote/tax';
import { buildBatchText } from '../src/quote/text';
import { computeStats } from '../src/stl/geometry';
import { testFonts } from './helpers/fonts';
import { cubeTriangles, toPositions } from './helpers/mesh';
import { pageTexts } from './helpers/pdf-text';

const HARD_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g');
const plain = (text: string): string => text.replace(HARD_SPACES, ' ');
const cube = (size: number): ReturnType<typeof computeStats> =>
  computeStats({ positions: toPositions(cubeTriangles(size)), triangleCount: 12, format: 'binary' });
const part = (name: string, size: number, patch: Partial<typeof DEFAULT_SETTINGS> = {}): BatchPart =>
  makePart(name, cube(size), { ...DEFAULT_SETTINGS, ...patch });

const date = new Date(2026, 9, 1, 10, 0, 0);
const business = { ...DEFAULT_BUSINESS, name: 'Taller Ñandú 3D', quoteNumber: '2026-012' };
const three = (): BatchPart[] => [part('soporte.stl', 20), part('tapa.stl', 31, { material: 'PETG', copies: 4 }), part('clip.stl', 12, { copies: 10 })];

beforeEach(() => setLang('es'));

describe('lote: texto copiado', () => {
  it('lleva todas las piezas, sus importes y el desglose del lote', () => {
    const parts = three();
    const totals = computeBatch(parts);
    const text = plain(buildBatchText({ parts, totals, date }));
    for (const p of parts) expect(text).toContain(p.fileName);
    expect(text).toContain('1 de octubre de 2026');
    expect(text).toContain('PIEZA 1 DE 3');
    expect(text).toContain('PIEZA 3 DE 3');
    expect(text).toContain('PETG');
    expect(text).toMatch(/TOTAL DEL LOTE\s+\d/);
    const euros = (n: number): string => n.toFixed(2).replace('.', ',') + ' €';
    expect(text).toContain(euros(totals.total));
    expect(text).toContain(euros(totals.subtotal));
    for (const p of parts) expect(text).toContain(euros(p.quote.total));
    expect(text).toContain('El tiempo es una estimación');
  });

  it('en inglés', () => {
    setLang('en');
    const parts = three();
    const text = buildBatchText({ parts, totals: computeBatch(parts), date });
    expect(text).toContain('PART 2 OF 3');
    expect(text).toContain('BATCH TOTAL');
  });
});

describe('lote: PDF', () => {
  const make = (parts: BatchPart[]): ReturnType<typeof buildBatchDocument> =>
    buildBatchDocument({ business, parts, date });

  it('el documento lleva una fila por pieza y el IVA se calcula una sola vez sobre la suma', () => {
    const parts = three();
    const doc = make(parts);
    expect(doc.batch?.rows).toHaveLength(3);
    expect(doc.batch?.rows[1]?.[0]).toBe('tapa.stl');
    expect(doc.batch?.head).toHaveLength(6);
    expect(doc.image).toBeNull();
    expect(doc.tax).toEqual(computeTax(computeBatch(parts).total, business.vatPercent));
    expect(doc.metadata.title).toContain('2026-012');
  });

  it('el PDF con 3 piezas es de una página y dibuja cada pieza y el total con IVA', async () => {
    const parts = three();
    const bytes = await renderQuotePdf(make(parts), testFonts);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const texts = plain((await pageTexts(bytes)).join('\n'));
    for (const p of parts) expect(texts).toContain(p.fileName);
    const tax = computeTax(computeBatch(parts).total, business.vatPercent);
    expect(texts).toContain(tax.total.toFixed(2).replace('.', ',') + ' €');
    expect(texts).toContain('Taller Ñandú 3D');
  });

  it('con 40 piezas pasa de página: repite la cabecera de la tabla, numera las páginas y deja el total en la última', async () => {
    const parts = Array.from({ length: 40 }, (_, i) => part(`pieza-${String(i + 1).padStart(2, '0')}.stl`, 10 + i));
    const bytes = await renderQuotePdf(make(parts), testFonts);
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPageCount();
    expect(pages).toBeGreaterThanOrEqual(2);
    const all: string[] = [];
    for (let i = 0; i < pages; i++) all.push(plain((await pageTexts(bytes, i)).join('\n')));
    // Todas las piezas aparecen exactamente una vez.
    for (const p of parts) expect(all.join('\n').split(p.fileName)).toHaveLength(2);
    // Página 2 en adelante repite las cabeceras de columna y todas llevan «Página n de N».
    all.forEach((text, i) => {
      expect(text).toContain(`Página ${i + 1} de ${pages}`);
      if (i > 0) expect(text).toContain('IMPORTE');
    });
    // El total con IVA solo aparece al final.
    const tax = computeTax(computeBatch(parts).total, business.vatPercent);
    expect(all.at(-1)).toContain(tax.total.toFixed(2).replace('.', ',') + ' €');
    expect(all[0]).not.toContain('Total con IVA');
  });

  it('los nombres con caracteres no latinos no rompen el PDF', async () => {
    const parts = [part('Привет-деталь.stl', 20), part('部品-ö.stl', 20)];
    const texts = (await pageTexts(await renderQuotePdf(make(parts), testFonts))).join('\n');
    expect(texts).toContain('Привет-деталь.stl');
    expect(texts).toContain('?'); // lo que la fuente no cubre sale como «?»
  });

  it('una sola pieza de una página no numera las páginas', async () => {
    const texts = (await pageTexts(await renderQuotePdf(make([part('a.stl', 20)]), testFonts))).join('\n');
    expect(texts).not.toMatch(/Página \d+ de/);
  });
});
