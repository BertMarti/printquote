import { describe, expect, it } from 'vitest';
import { BATCH_MAX, computeBatch, makePart, type BatchPart } from '../src/quote/batch';
import { createBatchEntry, createEntry, historyToCsv, normalizeHistory, type HistoryEntry } from '../src/quote/history';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeStats } from '../src/stl/geometry';
import { cubeTriangles, toPositions } from './helpers/mesh';

const cube = (size: number): ReturnType<typeof computeStats> =>
  computeStats({ positions: toPositions(cubeTriangles(size)), triangleCount: 12, format: 'binary' });
const part = (name: string, size: number, patch: Partial<typeof DEFAULT_SETTINGS> = {}): BatchPart =>
  makePart(name, cube(size), { ...DEFAULT_SETTINGS, ...patch });

const NOW = new Date(2026, 9, 1, 14, 5, 0);
const parts = (): BatchPart[] => [part('a.stl', 20), part('b.stl', 31, { material: 'PETG', copies: 4 }), part('c.stl', 12, { copies: 10 })];
const batchEntry = (list = parts(), client = 'Ana'): HistoryEntry => createBatchEntry({ client, parts: list, now: NOW, id: 'lote-1' });

describe('createBatchEntry', () => {
  it('el primer nivel es el agregado y `parts` guarda cada pieza con sus ajustes y su resultado', () => {
    const list = parts();
    const totals = computeBatch(list);
    const e = batchEntry(list);
    expect(e).toMatchObject({ id: 'lote-1', savedAt: NOW.toISOString(), client: 'Ana', fileName: 'a.stl, b.stl, c.stl', triangles: 36 });
    expect(e.volumeMm3).toBeCloseTo(list.reduce((acc, p) => acc + p.stats.volume, 0), 6);
    expect(e.size).toEqual({ x: 31, y: 31, z: 31 }); // máximo por eje
    expect(e.settings).toEqual(list[0]?.settings);
    expect(e.result).toEqual({
      weightGrams: totals.weightGrams,
      hours: totals.hours,
      materialCost: totals.materialCost,
      energyCost: totals.energyCost,
      marginAmount: totals.marginAmount,
      subtotal: totals.subtotal,
      total: totals.total,
    });
    expect(e.parts).toHaveLength(3);
    expect(e.parts?.[1]).toMatchObject({ fileName: 'b.stl', settings: { material: 'PETG', copies: 4 }, result: { total: list[1]?.quote.total } });
    // El total del lote es la suma de los de las piezas: lo guardado cuadra.
    const sum = Math.round((e.parts ?? []).reduce((acc, p) => acc + p.result.total * 100, 0)) / 100;
    expect(e.result.total).toBe(sum);
    // Nunca el archivo 3D ni la malla.
    expect(JSON.stringify(e)).not.toMatch(/positions|bounds/);
  });

  it('un nombre de lote muy largo se acota', () => {
    const many = Array.from({ length: 30 }, (_, i) => part(`pieza-con-nombre-largo-${i}.stl`, 10));
    expect(batchEntry(many).fileName.length).toBeLessThanOrEqual(200);
  });

  it('una entrada de una sola pieza no lleva `parts` (formato de siempre)', () => {
    const stats = cube(20);
    const e = createEntry({ fileName: 'x.stl', client: '', stats, settings: DEFAULT_SETTINGS, quote: computeQuote(stats, DEFAULT_SETTINGS) });
    expect(e.parts).toBeUndefined();
    expect('parts' in e).toBe(false);
  });
});

describe('normalizeHistory con lotes', () => {
  const roundTrip = (value: unknown): HistoryEntry[] => normalizeHistory(JSON.parse(JSON.stringify(value)));

  it('un lote sobrevive a guardar y leer, y una entrada antigua (sin `parts`) se lee igual', () => {
    const stats = cube(20);
    const old = createEntry({ fileName: 'x.stl', client: 'Luis', stats, settings: DEFAULT_SETTINGS, quote: computeQuote(stats, DEFAULT_SETTINGS), id: 'old' });
    const [a, b] = roundTrip([batchEntry(), old]) as [HistoryEntry, HistoryEntry];
    expect(a).toEqual(batchEntry());
    expect(b).toEqual(old);
    expect(b.parts).toBeUndefined();
  });

  it('un lote con una pieza rota se descarta entero; uno vacío o con demasiadas piezas, también', () => {
    const good = JSON.parse(JSON.stringify(batchEntry())) as Record<string, unknown>;
    const withParts = (list: unknown): unknown[] => [{ ...good, parts: list }];
    const goodParts = good['parts'] as Record<string, unknown>[];
    expect(normalizeHistory(withParts(goodParts))).toHaveLength(1);
    expect(normalizeHistory(withParts([goodParts[0], { ...goodParts[1], result: null }]))).toHaveLength(0);
    expect(normalizeHistory(withParts([goodParts[0], { ...goodParts[1], volumeMm3: 'x' }]))).toHaveLength(0);
    expect(normalizeHistory(withParts([]))).toHaveLength(0);
    expect(normalizeHistory(withParts('no'))).toHaveLength(0);
    expect(normalizeHistory(withParts(Array.from({ length: BATCH_MAX + 1 }, () => goodParts[0])))).toHaveLength(0);
  });

  it('los ajustes de cada pieza se normalizan al leer (fuera de rango se acotan)', () => {
    const raw = JSON.parse(JSON.stringify(batchEntry())) as { parts: { settings: Record<string, unknown> }[] };
    for (const piece of raw.parts.slice(0, 1)) piece.settings['infillPercent'] = 5000;
    const [entry] = normalizeHistory([raw]);
    expect(entry?.parts?.[0]?.settings.infillPercent).toBe(100);
  });
});

describe('CSV con lotes', () => {
  const split = (csv: string): string[] => csv.slice(1).split('\r\n');

  it('un lote da una fila por pieza, con la fecha y el cliente del lote, y la columna «Total» suma el lote', () => {
    const e = batchEntry();
    const lines = split(historyToCsv([e], 'en'));
    expect(lines).toHaveLength(1 + 3 + 1); // cabecera, 3 piezas, salto final
    const rows = lines.slice(1, 4).map((line) => line.split(','));
    expect(rows.map((r) => r[2])).toEqual(['a.stl', 'b.stl', 'c.stl']);
    for (const r of rows) expect(r[1]).toBe('Ana');
    expect(rows[1]?.[7]).toBe('PETG');
    expect(rows[1]?.[11]).toBe('4'); // copias de esa pieza
    const total = rows.reduce((acc, r) => acc + Number(r[17]), 0);
    expect(total).toBeCloseTo(e.result.total, 2);
  });

  it('una entrada de una pieza sigue dando una fila y se mezclan bien', () => {
    const stats = cube(20);
    const single = createEntry({ fileName: 'x.stl', client: '', stats, settings: DEFAULT_SETTINGS, quote: computeQuote(stats, DEFAULT_SETTINGS), id: 's' });
    expect(split(historyToCsv([single], 'es'))).toHaveLength(3);
    expect(split(historyToCsv([batchEntry(), single], 'es'))).toHaveLength(1 + 3 + 1 + 1);
  });

  it('el nombre de una pieza que empieza por «=» no se interpreta como fórmula', () => {
    const csv = historyToCsv([batchEntry([part('=HYPERLINK("x").stl', 10)])], 'en');
    expect(csv).not.toMatch(/\r\n=/);
    expect(csv).toContain(`'=HYPERLINK`);
  });
});
