import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildQuoteDocument, type QuoteDocument } from '../src/pdf/document';
import { renderQuotePdf as render } from '../src/pdf/render';
import {
  BUSINESS_MAX,
  DEFAULT_BUSINESS,
  firstQuoteNumber,
  isValidLogo,
  nextQuoteNumber,
  normalizeBusiness,
  validUntil,
  type BusinessProfile,
} from '../src/quote/business';
import { formatEuro } from '../src/quote/format';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeTax, DEFAULT_VAT_PERCENT } from '../src/quote/tax';
import { computeStats } from '../src/stl/geometry';
import { logoSize } from '../src/ui/logo';
import { testFonts } from './helpers/fonts';
import { cubeTriangles, toPositions } from './helpers/mesh';
import { pageTexts } from './helpers/pdf-text';

/** PNG de 1 × 1 píxel naranja. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const cube = (size: number): ReturnType<typeof computeStats> =>
  computeStats({ positions: toPositions(cubeTriangles(size)), triangleCount: 12, format: 'binary' });

const business = (overrides: Partial<BusinessProfile> = {}): BusinessProfile => ({
  ...DEFAULT_BUSINESS,
  name: 'Taller Ñandú 3D',
  taxId: 'B12345678',
  address: 'Calle Mayor 1\n28001 Madrid',
  phone: '+34 600 000 000',
  email: 'hola@example.com',
  web: 'example.com',
  quoteNumber: '2026-007',
  ...overrides,
});

const fixedDate = new Date(2026, 8, 30, 10, 0, 0);

function documentFor(size: number, overrides: Partial<BusinessProfile> = {}, copies = 1): ReturnType<typeof buildQuoteDocument> {
  const stats = cube(size);
  const settings = { ...DEFAULT_SETTINGS, copies };
  return buildQuoteDocument({
    business: business(overrides),
    fileName: 'cubo.stl',
    stats,
    settings,
    quote: computeQuote(stats, settings),
    image: null,
    date: fixedDate,
  });
}

describe('IVA', () => {
  it('21 % por defecto sobre la base imponible, redondeado a céntimos', () => {
    expect(DEFAULT_VAT_PERCENT).toBe(21);
    expect(computeTax(100, 21)).toEqual({ base: 100, vatPercent: 21, vat: 21, total: 121 });
    expect(computeTax(1.59, 21)).toEqual({ base: 1.59, vatPercent: 21, vat: 0.33, total: 1.92 }); // 0,3339 → 0,33
    expect(computeTax(0.1, 21)).toMatchObject({ vat: 0.02, total: 0.12 }); // 0,021 → 0,02
  });

  it('otros tipos: 10 %, 4 %, 0 % y decimales', () => {
    expect(computeTax(50, 10)).toMatchObject({ vat: 5, total: 55 });
    expect(computeTax(50, 4)).toMatchObject({ vat: 2, total: 52 });
    expect(computeTax(50, 0)).toMatchObject({ vat: 0, total: 50 });
    expect(computeTax(10, 5.5)).toMatchObject({ vat: 0.55, total: 10.55 });
  });

  it('redondeo de medio céntimo hacia arriba sin ruido de coma flotante', () => {
    expect(computeTax(0.05, 10).vat).toBe(0.01); // 0,005 → 0,01
    expect(computeTax(1.15, 10).vat).toBe(0.12); // 0,115 → 0,12
    expect(computeTax(33.33, 21).vat).toBe(7); // 6,9993 → 7,00
  });

  it('el total con IVA siempre es la suma de la base y la cuota (lo que se ve suma)', () => {
    for (const base of [0, 0.01, 0.07, 1.59, 12.34, 99.99, 1234.56]) {
      for (const rate of [0, 4, 5.5, 10, 21]) {
        const t = computeTax(base, rate);
        expect(t.total).toBeCloseTo(t.base + t.vat, 10);
        expect(Math.round(t.total * 100)).toBe(Math.round(t.base * 100) + Math.round(t.vat * 100));
      }
    }
  });

  it('entradas absurdas no dan NaN', () => {
    expect(computeTax(Number.NaN, 21)).toMatchObject({ base: 0, vat: 0, total: 0 });
    expect(computeTax(10, Number.NaN)).toMatchObject({ vat: 0, total: 10 });
    expect(computeTax(10, -5)).toMatchObject({ vat: 0, total: 10 });
  });
});

describe('datos del negocio', () => {
  it('por defecto: sin datos, 30 días de validez, 21 % de IVA y número AAAA-001', () => {
    expect(DEFAULT_BUSINESS).toMatchObject({ name: '', logo: null, validityDays: 30, vatPercent: 21 });
    expect(DEFAULT_BUSINESS.quoteNumber).toBe(firstQuoteNumber());
    expect(firstQuoteNumber(new Date(2031, 0, 1))).toBe('2031-001');
  });

  it('normaliza cualquier basura guardada', () => {
    expect(normalizeBusiness(null)).toEqual({ ...DEFAULT_BUSINESS });
    expect(normalizeBusiness('hola')).toEqual({ ...DEFAULT_BUSINESS });
    const dirty = normalizeBusiness({
      name: `  ${'x'.repeat(200)}\u0000\n`,
      address: 'línea 1\r\nlínea 2\u0007',
      phone: 5,
      logo: 'javascript:alert(1)',
      quoteNumber: '',
      validityDays: 0.2,
      vatPercent: 500,
    });
    expect(dirty.name).toHaveLength(BUSINESS_MAX.name);
    expect(dirty.address).toBe('línea 1\nlínea 2');
    expect(dirty.phone).toBe('');
    expect(dirty.logo).toBeNull();
    expect(dirty.quoteNumber).toBe(DEFAULT_BUSINESS.quoteNumber);
    expect(dirty.validityDays).toBe(1);
    expect(dirty.vatPercent).toBe(100);
    expect(normalizeBusiness({ vatPercent: -3, validityDays: 9999 })).toMatchObject({ vatPercent: 0, validityDays: 365 });
  });

  it('solo acepta logotipos PNG o JPEG en base64 y de tamaño razonable', () => {
    expect(isValidLogo(PNG_1X1)).toBe(true);
    expect(isValidLogo('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isValidLogo('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isValidLogo('data:image/png;base64,' + 'A'.repeat(700_000))).toBe(false);
    expect(isValidLogo('https://example.com/logo.png')).toBe(false);
    expect(isValidLogo(null)).toBe(false);
    expect(normalizeBusiness({ logo: PNG_1X1 }).logo).toBe(PNG_1X1);
  });

  it('el número de presupuesto sube el último grupo de cifras conservando ceros', () => {
    expect(nextQuoteNumber('2026-001')).toBe('2026-002');
    expect(nextQuoteNumber('2026-009')).toBe('2026-010');
    expect(nextQuoteNumber('2026-099')).toBe('2026-100');
    expect(nextQuoteNumber('PQ7')).toBe('PQ8');
    expect(nextQuoteNumber('A-12/B')).toBe('A-13/B');
    expect(nextQuoteNumber('sin cifras')).toBe('sin cifras-2');
    expect(nextQuoteNumber('9'.repeat(25))).toBe('1' + '0'.repeat(25));
  });

  it('la validez cuenta días naturales, también al cambiar de mes y de año', () => {
    expect(validUntil(new Date(2026, 8, 30, 23, 59), 30)).toEqual(new Date(2026, 9, 30));
    expect(validUntil(new Date(2026, 11, 15), 30)).toEqual(new Date(2027, 0, 14));
    expect(validUntil(new Date(2028, 1, 1), 28)).toEqual(new Date(2028, 1, 29)); // bisiesto
  });
});

describe('contenido del PDF', () => {
  it('cubo de 20 mm: desglose, base imponible, IVA del 21 % y total con IVA', () => {
    const doc = documentFor(20);
    // Total sin IVA del cubo con los valores por defecto: 0,10 €.
    expect(doc.tax).toEqual({ base: 0.1, vatPercent: 21, vat: 0.02, total: 0.12 });
    expect(doc.totalRows.map(([label]) => label)).toEqual(['Base imponible', 'IVA (21 %)', 'Total con IVA']);
    expect(doc.totalRows.map(([, value]) => value.replace(/\s/g, ' '))).toEqual(['0,10 €', '0,02 €', '0,12 €']);
  });

  it('un presupuesto más grande cuadra: base + IVA = total', () => {
    const doc = documentFor(80, { vatPercent: 10 }, 5);
    const eur = (value: string | undefined): number => Number((value ?? '').replace(/[^\d,]/g, '').replace(',', '.'));
    const [base, vat, total] = doc.totalRows.map(([, value]) => eur(value));
    expect(base).toBe(doc.tax.base);
    expect(vat).toBe(doc.tax.vat);
    expect(total).toBe(doc.tax.total);
    expect(Math.round((base ?? 0) * 100) + Math.round((vat ?? 0) * 100)).toBe(Math.round((total ?? 0) * 100));
    expect(doc.totalRows[1]?.[0]).toBe('IVA (10 %)');
  });

  it('IVA con decimales y número, fecha y validez del presupuesto', () => {
    const doc = documentFor(20, { vatPercent: 5.5, validityDays: 15 });
    expect(doc.totalRows[1]?.[0]).toBe('IVA (5,5 %)');
    expect(doc.meta).toEqual([
      ['Nº', '2026-007'],
      ['Fecha', '30 de septiembre de 2026'],
      ['Válido hasta', '15 de octubre de 2026'],
    ]);
  });

  it('emisor: NIF, dirección por líneas, teléfono, correo y web; sin datos, solo el título genérico', () => {
    expect(documentFor(20).issuerLines).toEqual(['NIF/CIF: B12345678', 'Calle Mayor 1', '28001 Madrid', '+34 600 000 000', 'hola@example.com', 'example.com']);
    const empty = documentFor(20, { name: '', taxId: '', address: '', phone: '', email: '', web: '' });
    expect(empty.issuerLines).toEqual([]);
    expect(empty.businessName).toBe('Presupuesto de impresión 3D');
  });

  it('con varias copias añade el precio por copia sin IVA', () => {
    expect(documentFor(20).breakdownRows.map(([l]) => l)).not.toContain('Precio por copia (sin IVA)');
    expect(documentFor(20, {}, 3).breakdownRows.map(([l]) => l)).toContain('Precio por copia (sin IVA)');
  });

  it('el tiempo se rotula siempre como estimación', () => {
    expect(documentFor(20).breakdownRows.map(([l]) => l)).toContain('Tiempo total (estimación)');
    expect(documentFor(20).notes.join(' ')).toMatch(/estimación/);
  });
});

/** Las fuentes se leen del disco (en el navegador se piden con fetch). */
const renderQuotePdf = (doc: QuoteDocument): Promise<Uint8Array> => render(doc, testFonts);

describe('generación del PDF', () => {
  it('genera un PDF de una página A4 con los metadatos y los importes correctos', async () => {
    const bytes = await renderQuotePdf(documentFor(20));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
    expect(pdf.getTitle()).toBe('Presupuesto de impresión 3D 2026-007');
    expect(pdf.getAuthor()).toBe('Taller Ñandú 3D');
    expect(pdf.getCreator()).toBe('printquote');

    const texts = await pageTexts(bytes);
    for (const expected of ['Taller Ñandú 3D', '2026-007', '30 de septiembre de 2026', 'TOTAL CON IVA', '0,12 €', 'Base imponible', 'IVA (21 %)', 'B12345678'.replace(/^/, 'NIF/CIF: ')]) {
      expect(texts, expected).toContain(expected);
    }
  });

  it('incrusta el logotipo y la vista 3D cuando los hay, y sigue sin ellos si no se pueden leer', async () => {
    const stats = cube(20);
    const settings = DEFAULT_SETTINGS;
    const make = (logo: string | null, image: string | null): ReturnType<typeof buildQuoteDocument> =>
      buildQuoteDocument({ business: business({ logo }), fileName: 'a.stl', stats, settings, quote: computeQuote(stats, settings), image, date: fixedDate });
    const imageCount = async (bytes: Uint8Array): Promise<number> => {
      const pdf = await PDFDocument.load(bytes);
      const xobjects = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'));
      return xobjects && 'keys' in xobjects ? (xobjects as unknown as { keys(): unknown[] }).keys().length : 0;
    };
    expect(await imageCount(await renderQuotePdf(make(null, null)))).toBe(0);
    expect(await imageCount(await renderQuotePdf(make(PNG_1X1, PNG_1X1)))).toBe(2);
    // Imágenes corruptas: el PDF se genera igualmente, sin ellas.
    expect(await imageCount(await renderQuotePdf(make('data:image/png;base64,AAAA', 'data:image/png;base64,AAAA')))).toBe(0);
  });

  it('caracteres que la fuente no tiene se transcriben o salen como «?» en vez de fallar', async () => {
    const stats = cube(20);
    const doc = buildQuoteDocument({
      business: business({ name: 'Łódź 印刷 3D', address: 'Ünïcode → ✓' }),
      fileName: 'pieza 🚀.stl',
      stats,
      settings: DEFAULT_SETTINGS,
      quote: computeQuote(stats, DEFAULT_SETTINGS),
      image: null,
      date: fixedDate,
    });
    const texts = await pageTexts(await renderQuotePdf(doc));
    expect(texts).toContain('Łódź ?? 3D');
    expect(texts.join('')).toContain('Ünïcode');
  });

  it('textos largos no rompen la maqueta: nombre, dirección y archivo muy largos', async () => {
    const long = 'Palabra'.repeat(40);
    const bytes = await renderQuotePdf(
      documentFor(20, { name: 'N'.repeat(80), address: `${long}\n${'línea '.repeat(30)}`, quoteNumber: 'X'.repeat(30) }, 3),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe('tamaño del logotipo', () => {
  it('limita el lado mayor sin ampliar ni deformar', () => {
    expect(logoSize(1600, 400)).toEqual({ width: 400, height: 100 });
    expect(logoSize(300, 1200)).toEqual({ width: 100, height: 400 });
    expect(logoSize(200, 100)).toEqual({ width: 200, height: 100 });
    expect(logoSize(10000, 1)).toEqual({ width: 400, height: 1 });
  });
});

describe('PDF: caracteres del español y transliteración', () => {
  const render = async (name: string, address = ''): Promise<string> => {
    const stats = cube(20);
    const doc = buildQuoteDocument({
      business: business({ name, address }),
      fileName: 'pieza.stl',
      stats,
      settings: DEFAULT_SETTINGS,
      quote: computeQuote(stats, DEFAULT_SETTINGS),
      image: null,
      date: fixedDate,
    });
    return (await pageTexts(await renderQuotePdf(doc))).join('\n');
  };

  it('á é í ó ú ñ ü ¿ ¡ € y sus mayúsculas salen tal cual, sin «?»', async () => {
    const text = await render('Áé íó úñ Ü', '¿Qué tal? ¡Hola! 5 € · Ñ É Í Ó Ú');
    for (const expected of ['Áé íó úñ Ü', '¿Qué tal? ¡Hola! 5 € · Ñ É Í Ó Ú']) expect(text).toContain(expected);
  });

  it('el latino extendido (polaco, turco, rumano, checo…) sale tal cual', async () => {
    const text = await render('Łódź Ćerić Çağrı Đorđe Őrs Ștefan', 'Řeka ě ř ň ť ů');
    expect(text).toContain('Łódź Ćerić Çağrı Đorđe Őrs Ștefan');
    expect(text).toContain('Řeka ě ř ň ť ů');
    expect(text).not.toContain('?');
  });

  it('lo que queda fuera de la fuente (vietnamita) se transcribe sin marcas en vez de «?»', async () => {
    const text = await render('Nguyễn Thị Ảnh', 'ǎ ǐ');
    expect(text).toContain('Nguyen Thi Anh');
    expect(text).toContain('a i');
    expect(text).not.toContain('?');
  });

  it('lo que no es transliterable da un solo «?» por carácter y los caracteres invisibles desaparecen', async () => {
    const text = await render('A印刷B 🚀 C​d️');
    expect(text).toContain('A??B ? Cd');
  });
});

describe('PDF: cirílico y griego', () => {
  it('el texto en cirílico y griego se ve en el PDF, sin «?» ni cuadros', async () => {
    const name = 'Печати «Ёж» Ελληνικά ώ';
    const address = 'ул. Ленина, 5 · Αθήνα 105 57';
    const texts = await pageTexts(await renderQuotePdf(documentFor(20, { name, address })));
    expect(texts).toContain(name);
    expect(texts).toContain('ул. Ленина, 5 · Αθήνα 105 57');
    const all = texts.join('');
    expect(all).not.toContain('?');
    expect(all).not.toContain('�');
  });

  it('también en los textos del documento: archivo, material y mayúsculas del título', async () => {
    const stats = cube(20);
    const doc = buildQuoteDocument({
      business: business({ name: 'Ελληνική Φάρμα' }),
      fileName: 'деталь-ω.stl',
      stats,
      settings: DEFAULT_SETTINGS,
      quote: computeQuote(stats, DEFAULT_SETTINGS),
      image: null,
      date: fixedDate,
    });
    const texts = await pageTexts(await renderQuotePdf(doc));
    expect(texts).toContain('деталь-ω.stl');
    expect(texts).toContain('Ελληνική Φάρμα');
  });

  it('el PDF solo lleva los glifos usados (subconjunto): pesa mucho menos que las fuentes completas', async () => {
    const bytes = await renderQuotePdf(documentFor(20, { name: 'Привет Ελλάδα' }));
    const fontsTotal = Object.values(testFonts).reduce((sum, font) => sum + font.length, 0);
    expect(bytes.length).toBeLessThan(fontsTotal / 3);
  });
});

describe('PDF: IVA con decimales y dirección larga', () => {
  it('el tipo de IVA se guarda con 2 decimales y se rotula tal como se aplica (10,55 % no sale como 10,6 %)', () => {
    expect(normalizeBusiness({ vatPercent: 21.567 }).vatPercent).toBe(21.57);
    expect(documentFor(20, { vatPercent: 10.55 }).totalRows[1]?.[0]).toBe('IVA (10,55 %)');
    expect(documentFor(20, { vatPercent: 0 }).totalRows[1]).toEqual(['IVA (0 %)', formatEuro(0)]);
    const zero = documentFor(20, { vatPercent: 0 });
    expect(zero.totalRows[2]?.[1]).toBe(zero.totalRows[0]?.[1]);
  });

  it('una dirección de muchas líneas no empuja el resto fuera de la página: se recorta con puntos suspensivos', async () => {
    const address = Array.from({ length: 60 }, (_, i) => `L${i + 1}`).join('\n');
    const texts = await pageTexts(await renderQuotePdf(documentFor(20, { address })));
    expect(texts).toContain('L1');
    expect(texts.some((t) => t === 'L60')).toBe(false);
    expect(texts.some((t) => t.endsWith('...'))).toBe(true);
    expect(texts).toContain('TOTAL CON IVA');
  });
});
