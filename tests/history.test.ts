import { describe, expect, it } from 'vitest';
import {
  addEntry,
  CLIENT_MAX,
  createEntry,
  HISTORY_MAX,
  historyToCsv,
  normalizeHistory,
  removeEntry,
  type HistoryEntry,
} from '../src/quote/history';
import { computeQuote } from '../src/quote/model';
import { applyPrinter } from '../src/quote/printers';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeStats } from '../src/stl/geometry';
import { cubeTriangles, toPositions } from './helpers/mesh';

const stats = computeStats({ positions: toPositions(cubeTriangles(20)), triangleCount: 12, format: 'binary' });
const NOW = new Date(2026, 9, 1, 14, 5, 0); // 2026-10-01 14:05, hora local

function entry(overrides: Partial<Parameters<typeof createEntry>[0]> = {}): HistoryEntry {
  return createEntry({
    fileName: 'cubo.stl',
    client: 'Ana',
    stats,
    settings: DEFAULT_SETTINGS,
    quote: computeQuote(stats, DEFAULT_SETTINGS),
    now: NOW,
    id: 'id-1',
    ...overrides,
  });
}

describe('createEntry', () => {
  it('guarda la pieza, el cliente, los parámetros y el resultado tal como salió, y nada más', () => {
    const quote = computeQuote(stats, DEFAULT_SETTINGS);
    const e = entry();
    expect(e.id).toBe('id-1');
    expect(e.savedAt).toBe(NOW.toISOString());
    expect(e.fileName).toBe('cubo.stl');
    expect(e.client).toBe('Ana');
    expect(e.volumeMm3).toBe(stats.volume);
    expect(e.size).toEqual({ x: 20, y: 20, z: 20 });
    expect(e.triangles).toBe(12);
    expect(e.settings).toEqual(DEFAULT_SETTINGS);
    expect(e.result).toEqual({
      weightGrams: quote.totalWeightGrams,
      hours: quote.totalHours,
      materialCost: quote.materialCost,
      energyCost: quote.energyCost,
      marginAmount: quote.marginAmount,
      subtotal: quote.subtotal,
      total: quote.total,
    });
    // Nada de la malla (posiciones) ni de los datos del negocio: cabe en unos centenares de bytes.
    expect(JSON.stringify(e).length).toBeLessThan(1200);
  });

  it('recorta y limpia el cliente (una sola línea, hasta 80 caracteres) y acorta nombres enormes', () => {
    expect(entry({ client: '  Ana\nPérez\t ' }).client).toBe('Ana Pérez');
    expect(entry({ client: 'x'.repeat(500) }).client).toHaveLength(CLIENT_MAX);
    expect(entry({ client: '' }).client).toBe('');
    expect(entry({ fileName: 'a'.repeat(1000) + '.stl' }).fileName.length).toBeLessThanOrEqual(200);
  });

  it('sin id, genera uno distinto cada vez', () => {
    const a = createEntry({ fileName: 'a', client: '', stats, settings: DEFAULT_SETTINGS, quote: computeQuote(stats, DEFAULT_SETTINGS), now: NOW });
    const b = createEntry({ fileName: 'a', client: '', stats, settings: DEFAULT_SETTINGS, quote: computeQuote(stats, DEFAULT_SETTINGS), now: NOW });
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThan(8);
  });
});

describe('addEntry y removeEntry', () => {
  it('el más reciente va primero', () => {
    const { entries } = addEntry([entry({ id: 'a' })], entry({ id: 'b' }));
    expect(entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it(`con ${HISTORY_MAX} guardados, al añadir uno se descarta el más antiguo y se avisa`, () => {
    let list: readonly HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_MAX; i++) list = addEntry(list, entry({ id: `e${i}` })).entries;
    expect(list).toHaveLength(HISTORY_MAX);
    const result = addEntry(list, entry({ id: 'nuevo' }));
    expect(result.dropped).toBe(1);
    expect(result.entries).toHaveLength(HISTORY_MAX);
    expect(result.entries[0]?.id).toBe('nuevo');
    expect(result.entries.some((e) => e.id === 'e0')).toBe(false);
    expect(addEntry([], entry()).dropped).toBe(0);
  });

  it('borra una entrada por id (y si no existe, deja la lista igual)', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b' })];
    expect(removeEntry(list, 'a').map((e) => e.id)).toEqual(['b']);
    expect(removeEntry(list, 'zzz')).toEqual(list);
  });
});

describe('normalizeHistory (lo que viene de localStorage no es de fiar)', () => {
  it('lo guardado y leído de vuelta es lo mismo', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b', client: 'Luis' })];
    expect(normalizeHistory(JSON.parse(JSON.stringify(list)))).toEqual(list);
  });

  it('descarta una a una las entradas rotas sin tirar el resto', () => {
    const good = entry({ id: 'good' });
    const raw: unknown[] = [
      good,
      null,
      42,
      'texto',
      { ...good, id: '' },
      { ...good, id: 'sin-fecha', savedAt: 'no es una fecha' },
      { ...good, id: 'sin-pieza', fileName: 7 },
      { ...good, id: 'total-nan', result: { ...good.result, total: 'x' } },
      { ...good, id: 'infinito', volumeMm3: Number.POSITIVE_INFINITY },
      { ...good, id: 'sin-resultado', result: undefined },
    ];
    expect(normalizeHistory(raw).map((e) => e.id)).toEqual(['good']);
  });

  it('no es una lista: vacío; repite id: se queda la primera; y respeta el máximo', () => {
    expect(normalizeHistory(undefined)).toEqual([]);
    expect(normalizeHistory({})).toEqual([]);
    expect(normalizeHistory([entry({ id: 'a', client: 'uno' }), entry({ id: 'a', client: 'dos' })]).map((e) => e.client)).toEqual(['uno']);
    const many = Array.from({ length: HISTORY_MAX + 20 }, (_, i) => entry({ id: `e${i}` }));
    expect(normalizeHistory(many)).toHaveLength(HISTORY_MAX);
  });

  it('los parámetros fuera de rango se acotan como en los ajustes, y el cliente se limpia', () => {
    const raw = [{ ...entry({ id: 'a' }), settings: { ...DEFAULT_SETTINGS, infillPercent: 5000, perimeters: -3 }, client: 'x'.repeat(300) }];
    const [only] = normalizeHistory(raw);
    expect(only?.settings.infillPercent).toBe(100);
    expect(only?.settings.perimeters).toBe(0);
    expect(only?.client).toHaveLength(CLIENT_MAX);
  });
});

describe('historyToCsv', () => {
  const printerSettings = applyPrinter({ ...DEFAULT_SETTINGS, material: 'PETG', copies: 2 }, 'bambu-a1');

  it('en español: BOM, separador «;», decimales con coma, fecha local y cabecera traducida', () => {
    const csv = historyToCsv([entry({ id: 'a', settings: printerSettings, quote: computeQuote(stats, printerSettings) })], 'es');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [header, row, end] = csv.slice(1).split('\r\n');
    expect(end).toBe('');
    expect(header).toBe(
      'Fecha;Cliente;Pieza;Volumen (cm³);X (mm);Y (mm);Z (mm);Material;Impresora;Relleno (%);Perímetros;Copias;Peso (g);Tiempo (h);Coste de material (€);Coste de energía (€);Margen (€);Total sin IVA (€)',
    );
    const cells = (row ?? '').split(';');
    expect(cells).toHaveLength(18);
    expect(cells.slice(0, 3)).toEqual(['2026-10-01 14:05', 'Ana', 'cubo.stl']);
    expect(cells[3]).toBe('8,00');
    expect(cells.slice(4, 7)).toEqual(['20,0', '20,0', '20,0']);
    expect(cells.slice(7, 9)).toEqual(['PETG', 'Bambu Lab A1']);
    expect(cells.slice(9, 12)).toEqual(['20', '2', '2']);
    expect(row).not.toMatch(/\d\.\d/); // ningún punto decimal
  });

  it('en inglés: «,» como separador, punto decimal y cabecera en inglés', () => {
    const csv = historyToCsv([entry()], 'en');
    const [header, row] = csv.slice(1).split('\r\n');
    expect(header?.startsWith('Date,Client,Part,Volume (cm³),X (mm)')).toBe(true);
    expect(row?.startsWith('2026-10-01 14:05,Ana,cubo.stl,8.00,20.0,20.0,20.0,PLA,Custom,')).toBe(true);
    expect(header).toContain('Total excl. VAT (€)');
  });

  it('sin presupuestos: solo la cabecera', () => {
    const lines = historyToCsv([], 'es').slice(1).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('');
  });

  it('entrecomilla lo que lleva separador, comillas o saltos de línea y duplica las comillas', () => {
    const csv = historyToCsv([entry({ fileName: 'pieza "A"; v2.stl', client: 'Pérez, Ana' })], 'es');
    expect(csv).toContain('"pieza ""A""; v2.stl"');
    const en = historyToCsv([entry({ fileName: 'pieza "A"; v2.stl', client: 'Pérez, Ana' })], 'en');
    expect(en).toContain('"Pérez, Ana"');
    // Un salto de línea en el nombre (los archivos pueden tenerlo) no parte la fila.
    const withBreak = historyToCsv([entry({ fileName: 'a\nb.stl' })], 'es').slice(1).split('\r\n');
    expect(withBreak.join('|')).toContain('"a\nb.stl"');
  });

  it('neutraliza las fórmulas: texto que empieza por = + - @ tabulador o retorno lleva un apóstrofo delante', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUMA(A1)', '\tcmd', '\rcmd']) {
      const csv = historyToCsv([entry({ client: evil, fileName: evil })], 'es');
      const body = csv.slice(1).split('\r\n').slice(1).join('\r\n');
      expect(body).not.toMatch(/(^|;)"?[=+\-@\t\r]/);
      expect(body).toContain(`'${evil.replace(/"/g, '""')}`);
    }
    // Un número negativo en una columna numérica no es texto de usuario: sigue siendo número.
    expect(historyToCsv([entry()], 'es')).not.toContain("'-");
  });
});
