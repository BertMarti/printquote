// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBatchDocument, buildQuoteDocument } from '../src/pdf/document';
import { pdfLabels } from '../src/pdf/labels';
import { PDFDocument } from 'pdf-lib';
import { renderQuotePdf } from '../src/pdf/render';
import { DEFAULT_BUSINESS, normalizeBusiness } from '../src/quote/business';
import { makePart } from '../src/quote/batch';
import { createEntry, normalizeHistory, NOTE_MAX } from '../src/quote/history';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeStats } from '../src/stl/geometry';
import { binaryStl, cubeTriangles, toPositions } from './helpers/mesh';
import { testFonts } from './helpers/fonts';
import { startApp } from '../src/ui/app';
import { loadBusiness } from '../src/ui/storage';
import { fontResponse } from './helpers/fonts';

const HISTORY_KEY = 'printquote:historial:v1';
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const stats = computeStats({ positions: toPositions(cubeTriangles(20)), triangleCount: 12, format: 'binary' });
const quote = computeQuote(stats, DEFAULT_SETTINGS);
const business = { ...DEFAULT_BUSINESS, name: 'Taller', quoteNumber: '2026-001' };

describe('presupuesto 1.1', () => {
  it('normaliza la autonumeración y la validez opcional sin romper datos v1.0', () => {
    expect(normalizeBusiness(undefined).autoNumber).toBe(true);
    expect(normalizeBusiness({ quoteNumber: '', autoNumber: false, validityDays: 0 })).toMatchObject({ autoNumber: false, quoteNumber: '', validityDays: 0 });
    expect(normalizeBusiness({ quoteNumber: '' }).quoteNumber).toMatch(/^\d{4}-001$/);
    expect(normalizeBusiness({ quoteNumber: '2026-004', validityDays: 30 })).toMatchObject({ quoteNumber: '2026-004', autoNumber: true });
  });

  it('omite número y validez, y limita las notas del presupuesto', () => {
    const doc = buildQuoteDocument({
      business: { ...business, quoteNumber: '', validityDays: 0 },
      fileName: 'cubo.stl', stats, settings: DEFAULT_SETTINGS, quote, image: null,
      quoteNotes: 'uno\u0000\ndos\ntres\ncuatro\ncinco\nseis',
      labels: pdfLabels('en'),
    });
    expect(doc.meta.some(([label]) => label === 'No.')).toBe(false);
    expect(doc.meta.some(([label]) => label === 'Valid until')).toBe(false);
    expect(doc.metadata.title).toBe('3D print quote');
    expect(doc.numberText).toBe('');
    expect(doc.notes).not.toContain(pdfLabels('en').noteValidity);
    expect(doc.quoteNotes).toEqual(['uno', 'dos', 'tres', 'cuatro']);
    expect(buildQuoteDocument({ business: { ...business, quoteNumber: '', validityDays: 0 }, fileName: 'x', stats, settings: DEFAULT_SETTINGS, quote, image: null }).quoteNotes).toEqual([]);
  });

  it('construye un PDF válido con campos largos y datos no confiables', async () => {
    const doc = buildQuoteDocument({
      business: {
        ...business,
        name: '😀'.repeat(80),
        address: `${'عنوان عربي <script>\u0000\n'.repeat(20)}`,
        notes: 'nota\n'.repeat(50),
        quoteNumber: '', validityDays: 0,
      },
      fileName: '<script>😀.stl', stats, settings: DEFAULT_SETTINGS, quote, image: null,
      client: '<img src=x onerror=alert(1)>', quoteNotes: 'nota\n'.repeat(20),
    });
    const bytes = await renderQuotePdf(doc, testFonts);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('con todo vacío el PDF sale igual que antes (una página, con Nº si hay autonumeración)', async () => {
    const doc = buildQuoteDocument({ business: DEFAULT_BUSINESS, fileName: 'cubo.stl', stats, settings: DEFAULT_SETTINGS, quote, image: null });
    expect(doc.meta[0]?.[1]).toBe(DEFAULT_BUSINESS.quoteNumber);
    expect(doc.meta.map(([label]) => label)).toEqual(['Nº', 'Fecha', 'Válido hasta']);
    expect(doc.quoteNotes).toEqual([]);
    const bytes = await renderQuotePdf(doc, testFonts);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('las notas que no caben pasan a otra página (no pisan el pie)', async () => {
    const base = buildQuoteDocument({ business, fileName: 'cubo.stl', stats, settings: DEFAULT_SETTINGS, quote, image: null });
    const lines = Array.from({ length: 60 }, (_, i) => `Línea de condiciones número ${i + 1}`);
    const bytes = await renderQuotePdf({ ...base, notes: lines, quoteNotes: lines.slice(0, 4) }, testFonts);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it('conserva las notas del historial y mantiene compatibilidad con v1.0', () => {
    const saved = createEntry({ fileName: 'cubo.stl', client: 'Ana', note: '  una\r\ndos\u0000 ', stats, settings: DEFAULT_SETTINGS, quote, id: 'with-note' });
    expect(saved.note).toBe('una\ndos');
    const old = { ...saved, id: 'old', note: undefined };
    const bad = { ...saved, id: 'bad', note: 42 };
    const entries = normalizeHistory([old, bad]);
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'old' }), expect.objectContaining({ id: 'bad' })]));
    expect(entries.find((entry) => entry.id === 'bad')?.note).toBeUndefined();
    expect('note' in (entries.find((entry) => entry.id === 'old') ?? {})).toBe(false);
    expect(createEntry({ fileName: 'c', client: '', note: 'x'.repeat(500), stats, settings: DEFAULT_SETTINGS, quote }).note).toHaveLength(NOTE_MAX);
    expect('note' in createEntry({ fileName: 'c', client: '', note: '   ', stats, settings: DEFAULT_SETTINGS, quote })).toBe(false);
  });

  it('genera el documento de lote con notas y etiquetas inglesas', () => {
    const part = makePart('cubo.stl', stats, DEFAULT_SETTINGS);
    const doc = buildBatchDocument({ business, parts: [part], quoteNotes: 'Recoger el viernes', labels: pdfLabels('en') });
    expect(doc.quoteNotes).toEqual(['Recoger el viernes']);
    expect(doc.quoteNotesTitle).toBe('Notes');
  });

  describe('formulario', () => {
    const downloads: string[] = [];
    const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
    const type = (id: string, value: string): void => {
      const input = $<HTMLInputElement | HTMLTextAreaElement>(id);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    async function until(check: () => boolean): Promise<void> {
      for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(check()).toBe(true);
    }
    async function loadSampleAndPdf(): Promise<void> {
      $('sample-button').click();
      await until(() => $('out-total').textContent !== '—');
      $('pdf-button').click();
      await until(() => downloads.length === 1);
      await until(() => !$<HTMLButtonElement>('pdf-button').disabled);
    }

    beforeEach(() => {
      downloads.length = 0;
      document.body.innerHTML = body;
      window.localStorage.clear();
      vi.stubGlobal('Worker', undefined);
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });
      const stl = binaryStl(cubeTriangles(20));
      vi.stubGlobal('fetch', vi.fn(async (url: unknown) => fontResponse(url) ?? new Response(stl.slice(0))));
    });

    it('sin autonumeración el número no sube y el anuncio no habla del próximo', async () => {
      startApp();
      $<HTMLInputElement>('in-biz-autonumber').click();
      type('in-biz-number', 'PED-77 Ana');
      await loadSampleAndPdf();
      expect(downloads).toEqual(['presupuesto-PED-77-Ana.pdf']);
      expect($<HTMLInputElement>('in-biz-number').value).toBe('PED-77 Ana');
      expect(loadBusiness().quoteNumber).toBe('PED-77 Ana');
      await until(() => /PDF descargado/.test($('live-status').textContent ?? ''));
      expect($('live-status').textContent).not.toMatch(/próximo/);
    });

    it('sin autonumeración y sin número, el archivo lleva la fecha', async () => {
      startApp();
      $<HTMLInputElement>('in-biz-autonumber').click();
      type('in-biz-number', '');
      expect(loadBusiness().quoteNumber).toBe('');
      await loadSampleAndPdf();
      expect(downloads[0]).toMatch(/^presupuesto-\d{4}-\d{2}-\d{2}\.pdf$/);
      expect(loadBusiness().quoteNumber).toBe('');
    });

    it('con autonumeración (por defecto) sube como antes; al volver a marcarla, un número vacío vuelve al inicial', async () => {
      startApp();
      type('in-biz-number', '2026-009');
      await loadSampleAndPdf();
      expect(loadBusiness().quoteNumber).toBe('2026-010');
      const box = $<HTMLInputElement>('in-biz-autonumber');
      box.click();
      type('in-biz-number', '');
      box.click();
      expect(loadBusiness()).toMatchObject({ autoNumber: true, quoteNumber: DEFAULT_BUSINESS.quoteNumber });
      expect($<HTMLInputElement>('in-biz-number').value).toBe(DEFAULT_BUSINESS.quoteNumber);
    });

    it('si se cambia el número mientras se genera el PDF, no se pisa al terminar', async () => {
      startApp();
      type('in-biz-number', '2026-009');
      $('sample-button').click();
      await until(() => $('out-total').textContent !== '—');
      $('pdf-button').click();
      type('in-biz-number', 'A-1'); // durante la generación (asíncrona)
      await until(() => downloads.length === 1);
      await until(() => !$<HTMLButtonElement>('pdf-button').disabled);
      expect(downloads).toEqual(['presupuesto-2026-009.pdf']);
      expect(loadBusiness().quoteNumber).toBe('A-1');
      expect($<HTMLInputElement>('in-biz-number').value).toBe('A-1');
    });

    it('validez 0 se acepta sin error y tiene su pista accesible', () => {
      startApp();
      type('in-biz-validity', '0');
      expect($('err-validity').textContent).toBe('');
      expect(loadBusiness().validityDays).toBe(0);
      expect($('in-biz-validity').getAttribute('aria-describedby')).toContain('hint-validity');
      expect($('hint-validity').textContent).toMatch(/sin fecha de validez/);
    });

    it('la pista del número sigue a la casilla también al cambiar de idioma', () => {
      startApp();
      $<HTMLInputElement>('in-biz-autonumber').click();
      document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
      expect($('hint-number').textContent).toMatch(/Used as entered/);
      document.querySelector<HTMLButtonElement>('button[data-lang="es"]')?.click();
      expect($('hint-number').textContent).toMatch(/tal cual/);
    });

    it('las notas de este presupuesto se guardan con él y vuelven al abrirlo; el cliente es texto', async () => {
      startApp();
      $('sample-button').click();
      await until(() => $('out-total').textContent !== '—');
      type('in-client', '<img src=x onerror=alert(1)>');
      type('in-quote-notes', 'Color rojo.\nRecogida el viernes.');
      $('history-save').click();
      type('in-client', '');
      type('in-quote-notes', '');
      const open = document.querySelector<HTMLButtonElement>('#history-list button[data-action="open"]');
      expect(open).not.toBeNull();
      open?.click();
      expect($<HTMLTextAreaElement>('in-quote-notes').value).toBe('Color rojo.\nRecogida el viernes.');
      expect($<HTMLInputElement>('in-client').value).toBe('<img src=x onerror=alert(1)>');
      expect(document.querySelectorAll('img[src="x"]')).toHaveLength(0);
      // Las notas no viajan en el enlace para compartir ni se guardan solas.
      expect(window.location.hash).not.toMatch(/rojo/);
      const keysWithNote = Object.keys(window.localStorage).filter((key) => (window.localStorage.getItem(key) ?? '').includes('Recogida el viernes'));
      expect(keysWithNote).toEqual([HISTORY_KEY]);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      window.localStorage.clear();
    });

    it('recuerda la casilla y cambia la pista del número', () => {
      startApp();
      const checkbox = document.getElementById('in-biz-autonumber') as HTMLInputElement;
      const hint = document.getElementById('hint-number');
      expect(checkbox.checked).toBe(true);
      checkbox.click();
      expect(hint?.textContent).toContain('tal cual');
      expect(loadBusiness().autoNumber).toBe(false);
      document.body.innerHTML = body;
      startApp();
      expect((document.getElementById('in-biz-autonumber') as HTMLInputElement).checked).toBe(false);
    });
  });
});
