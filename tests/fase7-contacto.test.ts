import { describe, expect, it } from 'vitest';
import { buildBatchDocument, buildQuoteDocument } from '../src/pdf/document';
import { PDFDocument } from 'pdf-lib';
import { renderQuotePdf } from '../src/pdf/render';
import { DEFAULT_BUSINESS, normalizeBusiness } from '../src/quote/business';
import { isValidEmail, isValidPhone } from '../src/quote/contact';
import { makePart } from '../src/quote/batch';
import { countWithContact, createEntry, EMAIL_MAX, historyToCsv, normalizeHistory, PHONE_MAX, withoutContact } from '../src/quote/history';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeStats } from '../src/stl/geometry';
import { cubeTriangles, toPositions } from './helpers/mesh';
import { testFonts } from './helpers/fonts';

const stats = computeStats({ positions: toPositions(cubeTriangles(20)), triangleCount: 12, format: 'binary' });
const quote = computeQuote(stats, DEFAULT_SETTINGS);

describe('contacto del cliente', () => {
  it('valida correo y teléfono sin considerar vacío un error', () => {
    expect(isValidEmail('')).toBe(true);
    expect(isValidEmail('ana@example.com')).toBe(true);
    expect(isValidEmail('ana@example')).toBe(false);
    expect(isValidEmail('ana example.com')).toBe(false);
    expect(isValidPhone('')).toBe(true);
    expect(isValidPhone('+34 600-123-456')).toBe(true);
    expect(isValidPhone('(600) 123 456')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone('34/600123456')).toBe(false);
    expect(isValidPhone('34+600123456')).toBe(false);
    expect(isValidPhone('123456789012345678901')).toBe(false);
  });

  it('limpia y limita el contacto, y omite vacíos', () => {
    const entry = createEntry({
      fileName: 'pieza.stl', client: '', stats, settings: DEFAULT_SETTINGS, quote,
      email: `  ana\u0000  ${'a'.repeat(120)} `, phone: `  +34\n${'6'.repeat(50)} `,
    });
    expect(entry.email).toHaveLength(EMAIL_MAX);
    expect(entry.email).not.toContain('\n');
    expect(entry.phone).toHaveLength(PHONE_MAX);
    expect('email' in createEntry({ fileName: 'x', client: '', stats, settings: DEFAULT_SETTINGS, quote, email: '  ' })).toBe(false);
  });

  it('lee entradas antiguas y descarta solo contactos de tipo incorrecto', () => {
    const old = createEntry({ fileName: 'pieza.stl', client: '', stats, settings: DEFAULT_SETTINGS, quote, note: 'nota' });
    const entries = normalizeHistory([{ ...old, email: 42, phone: null }]);
    expect(entries[0]).toMatchObject({ id: old.id, note: 'nota' });
    expect(entries[0]).not.toHaveProperty('email');
    expect(entries[0]).not.toHaveProperty('phone');
    expect(normalizeBusiness({ ...DEFAULT_BUSINESS, saveContact: undefined }).saveContact).toBe(true);
  });

  it('añade correo y teléfono al CSV tras el cliente y protege fórmulas', () => {
    const entry = createEntry({ fileName: '=cmd.stl', client: '=cliente', email: '=cmd', phone: '+34 600 123 456', stats, settings: DEFAULT_SETTINGS, quote });
    const csv = historyToCsv([entry], 'es');
    expect(csv.split('\r\n')[0]).toContain('Fecha;Cliente;Correo;Teléfono;Pieza;');
    expect(csv).toContain(";'=cliente;'=cmd;'+34 600 123 456;'=cmd.stl;");
  });

  it('construye contacto en el orden correo y teléfono, también para lotes', () => {
    const business = { ...DEFAULT_BUSINESS, name: 'Taller' };
    const doc = buildQuoteDocument({ business, fileName: 'pieza.stl', stats, settings: DEFAULT_SETTINGS, quote, image: null, email: 'ana@example.com', phone: '+34 600 123 456' });
    expect(doc.contact).toEqual([['Correo', 'ana@example.com'], ['Teléfono', '+34 600 123 456']]);
    expect(buildQuoteDocument({ business, fileName: 'pieza.stl', stats, settings: DEFAULT_SETTINGS, quote, image: null }).contact).toEqual([]);
    const part = makePart('pieza.stl', stats, DEFAULT_SETTINGS);
    expect(buildBatchDocument({ business, parts: [part], email: 'ana@example.com', phone: '+34 600 123 456' }).contact).toEqual(doc.contact);
  });

  it('parte un correo largo y mantiene el PDF de una pieza en una página', async () => {
    const doc = buildQuoteDocument({
      business: DEFAULT_BUSINESS,
      fileName: 'pieza.stl', stats, settings: DEFAULT_SETTINGS, quote, image: null,
      email: `${'a'.repeat(96)}@x.com`,
    });
    const pdf = await renderQuotePdf(doc, testFonts);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it('countWithContact y withoutContact: quita solo el correo y el teléfono', () => {
    const withBoth = createEntry({ fileName: 'a.stl', client: 'Ana', note: 'n', email: 'a@b.es', phone: '600123456', stats, settings: DEFAULT_SETTINGS, quote, id: 'a' });
    const onlyPhone = createEntry({ fileName: 'b.stl', client: '', phone: '600123456', stats, settings: DEFAULT_SETTINGS, quote, id: 'b' });
    const none = createEntry({ fileName: 'c.stl', client: '', stats, settings: DEFAULT_SETTINGS, quote, id: 'c' });
    expect(countWithContact([withBoth, onlyPhone, none])).toBe(2);
    const clean = withoutContact([withBoth, onlyPhone, none]);
    expect(countWithContact(clean)).toBe(0);
    expect(clean[0]).toEqual((({ email: _e, phone: _p, ...rest }) => rest)(withBoth));
    expect(clean[2]).toBe(none);
  });
});
