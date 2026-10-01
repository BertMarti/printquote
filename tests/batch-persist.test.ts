// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BATCH_MAX, computeBatch, makePart, type BatchPart } from '../src/quote/batch';
import { batchFromParts, normalizeBatchParts, normalizeHistory, partToHistory } from '../src/quote/history';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeStats } from '../src/stl/geometry';
import { loadBatch, saveBatch } from '../src/ui/storage';
import { cubeTriangles, toPositions } from './helpers/mesh';

const cube = (size: number): ReturnType<typeof computeStats> =>
  computeStats({ positions: toPositions(cubeTriangles(size)), triangleCount: 12, format: 'binary' });
const part = (name: string, size: number, patch: Partial<typeof DEFAULT_SETTINGS> = {}): BatchPart =>
  makePart(name, cube(size), { ...DEFAULT_SETTINGS, ...patch });
const parts = (): BatchPart[] => [part('a.stl', 20), part('b.stl', 31, { material: 'PETG', copies: 4 }), part('c.stl', 12, { copies: 10 })];
const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe('línea ↔ pieza guardada', () => {
  it('la pieza guardada lleva el área y nunca la geometría', () => {
    const saved = partToHistory(part('a.stl', 20));
    expect(saved.surfaceMm2).toBeCloseTo(6 * 20 * 20, 6);
    expect(JSON.stringify(saved)).not.toMatch(/positions|bounds/);
  });

  it('ida y vuelta: mismos importes, recalculados con computeQuote', () => {
    const list = parts();
    const back = batchFromParts(list.map(partToHistory));
    if (!back) throw new Error('debía reconstruirse');
    expect(back.map((p) => p.quote)).toEqual(list.map((p) => p.quote));
    expect(back.map((p) => p.settings)).toEqual(list.map((p) => p.settings));
    expect(back.map((p) => p.fileName)).toEqual(['a.stl', 'b.stl', 'c.stl']);
    expect(computeBatch(back)).toEqual(computeBatch(list));
    expect(back[0]?.stats.bounds.size).toEqual(list[0]?.stats.bounds.size);
  });

  it('una pieza guardada sin área (v0.6) no se puede reconstruir', () => {
    const { surfaceMm2, ...old } = partToHistory(part('a.stl', 20));
    expect(surfaceMm2).toBeGreaterThan(0);
    expect(batchFromParts([old])).toBeNull();
  });
});

describe('normalizeBatchParts', () => {
  const good = (): Record<string, unknown>[] => roundTrip(parts().map(partToHistory)) as Record<string, unknown>[];

  it('acepta un lote válido', () => {
    expect(normalizeBatchParts(good())).toHaveLength(3);
  });

  it('descarta entero: pieza rota, sin área, vacío, demasiadas piezas o no es una lista', () => {
    const [a, b] = good() as [Record<string, unknown>, Record<string, unknown>];
    expect(normalizeBatchParts([a, { ...b, result: null }])).toBeNull();
    expect(normalizeBatchParts([a, { ...b, surfaceMm2: undefined }])).toBeNull();
    expect(normalizeBatchParts([a, { ...b, surfaceMm2: -1 }])).toBeNull();
    expect(normalizeBatchParts([a, { ...b, surfaceMm2: 'x' }])).toBeNull();
    expect(normalizeBatchParts([])).toBeNull();
    expect(normalizeBatchParts('no')).toBeNull();
    expect(normalizeBatchParts(Array.from({ length: BATCH_MAX + 1 }, () => a))).toBeNull();
  });

  it('el historial rechaza un `surfaceMm2` inválido pero lee las entradas sin él', () => {
    const [a] = good() as [Record<string, unknown>];
    const entry = { ...a, id: 'x', savedAt: new Date().toISOString(), client: '' };
    expect(normalizeHistory([entry])).toHaveLength(1);
    expect(normalizeHistory([{ ...entry, surfaceMm2: undefined }])[0]?.surfaceMm2).toBeUndefined();
    expect(normalizeHistory([{ ...entry, surfaceMm2: 'x' }])).toHaveLength(0);
  });
});

describe('normalizePart: topes', () => {
  const entry = (patch: Record<string, unknown>): unknown[] => {
    const [first] = roundTrip(parts().map(partToHistory)) as Record<string, unknown>[];
    return [{ ...first, id: 'x', savedAt: new Date().toISOString(), client: '', ...patch }];
  };

  it('acepta cifras de una pieza real y rechaza negativas o absurdas (1e308 daba «NaN»)', () => {
    expect(normalizeHistory(entry({}))).toHaveLength(1);
    expect(normalizeHistory(entry({ volumeMm3: 1.25e11 / 2 }))).toHaveLength(1);
    for (const bad of [{ volumeMm3: 1e308 }, { volumeMm3: -1 }, { triangles: -5 }, { triangles: 1e12 }, { size: { x: 1e308, y: 1, z: 1 } }, { size: { x: 1, y: -2, z: 1 } }, { surfaceMm2: 1e308 }]) {
      expect(normalizeHistory(entry(bad)), JSON.stringify(bad)).toHaveLength(0);
    }
  });

  it('un lote persistido con una cifra absurda se descarta entero', () => {
    const [first, second] = roundTrip(parts().map(partToHistory)) as Record<string, unknown>[];
    expect(normalizeBatchParts([first, { ...second, volumeMm3: 1e308 }])).toBeNull();
  });
});

describe('loadBatch / saveBatch', () => {
  const key = 'printquote:lote:v1';
  beforeEach(() => window.localStorage.clear());

  it('guarda y recupera las líneas con los mismos importes', () => {
    saveBatch(parts());
    expect(loadBatch().map((p) => p.quote)).toEqual(parts().map((p) => p.quote));
  });

  it('vaciar el lote borra la clave', () => {
    saveBatch(parts());
    saveBatch([]);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('sin clave, con JSON roto, con otra versión o con datos inválidos vuelve vacío', () => {
    expect(loadBatch()).toEqual([]);
    window.localStorage.setItem(key, '{no es json');
    expect(loadBatch()).toEqual([]);
    window.localStorage.setItem(key, JSON.stringify({ v: 2, parts: roundTrip(parts().map(partToHistory)) }));
    expect(loadBatch()).toEqual([]);
    window.localStorage.setItem(key, JSON.stringify({ v: 1, parts: [{ fileName: 'x' }] }));
    expect(loadBatch()).toEqual([]);
    window.localStorage.setItem(key, 'null');
    expect(loadBatch()).toEqual([]);
  });

  it('con la cuota llena borra la copia vieja: al recargar no reaparece un lote desfasado', () => {
    saveBatch(parts());
    const set = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    try {
      saveBatch([...parts(), part('d.stl', 15)]);
    } finally {
      set.mockRestore();
    }
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(loadBatch()).toEqual([]);
  });

  it('si localStorage falla (lleno, bloqueado) no lanza', () => {
    const set = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    const get = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    try {
      expect(() => saveBatch(parts())).not.toThrow();
      expect(loadBatch()).toEqual([]);
    } finally {
      set.mockRestore();
      get.mockRestore();
    }
  });
});
