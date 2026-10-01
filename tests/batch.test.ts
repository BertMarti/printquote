import { describe, expect, it } from 'vitest';
import { BATCH_MAX, computeBatch, makePart, type BatchPart } from '../src/quote/batch';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeStats } from '../src/stl/geometry';
import { cubeTriangles, toPositions } from './helpers/mesh';

const cube = (size: number): ReturnType<typeof computeStats> =>
  computeStats({ positions: toPositions(cubeTriangles(size)), triangleCount: 12, format: 'binary' });

const part = (name: string, size: number, patch: Partial<typeof DEFAULT_SETTINGS> = {}): BatchPart =>
  makePart(name, cube(size), { ...DEFAULT_SETTINGS, ...patch });

describe('lote: modelo de coste', () => {
  it('un lote vacío vale 0', () => {
    expect(computeBatch([])).toMatchObject({ parts: 0, copies: 0, weightGrams: 0, hours: 0, total: 0, subtotal: 0 });
  });

  it('una pieza: el lote es su presupuesto (misma fórmula, sin duplicarla)', () => {
    const p = part('a.stl', 20, { copies: 3 });
    const q = computeQuote(cube(20), { ...DEFAULT_SETTINGS, copies: 3 });
    expect(p.quote).toEqual(q);
    const b = computeBatch([p]);
    expect(b).toMatchObject({ parts: 1, copies: 3, total: q.total, subtotal: q.subtotal, materialCost: q.materialCost });
    expect(b.weightGrams).toBeCloseTo(q.totalWeightGrams, 9);
    expect(b.hours).toBeCloseTo(q.totalHours, 9);
  });

  it('el total es la suma de los totales de línea ya redondeados (como una factura)', () => {
    const parts = [part('a.stl', 20), part('b.stl', 31), part('c.stl', 12, { copies: 7 })];
    const sum = Math.round(parts.reduce((acc, p) => acc + p.quote.total * 100, 0)) / 100;
    const b = computeBatch(parts);
    expect(b.total).toBe(sum);
    // El desglose cuadra: material + energía = subtotal; subtotal + margen = total.
    expect(Math.round((b.materialCost + b.energyCost) * 100)).toBe(Math.round(b.subtotal * 100));
    expect(Math.round((b.subtotal + b.marginAmount) * 100)).toBe(Math.round(b.total * 100));
  });

  it('cada línea conserva los parámetros con que se añadió', () => {
    const pla = part('a.stl', 20);
    const petg = part('b.stl', 20, { material: 'PETG', infillPercent: 60, copies: 4 });
    expect(pla.settings.material).toBe('PLA');
    expect(petg.settings).toMatchObject({ material: 'PETG', infillPercent: 60, copies: 4 });
    expect(petg.quote.total).toBeGreaterThan(pla.quote.total);
    expect(computeBatch([pla, petg]).copies).toBe(5);
  });

  it('quitar una pieza recalcula', () => {
    const [a, b, c] = [part('a.stl', 20), part('b.stl', 30), part('c.stl', 40)] as [BatchPart, BatchPart, BatchPart];
    const all = computeBatch([a, b, c]);
    const without = computeBatch([a, b, c].filter((p) => p.id !== b.id));
    expect(without.parts).toBe(2);
    expect(without.total).toBeCloseTo(all.total - b.quote.total, 9);
  });

  it('cada pieza tiene un id propio y el tope es de 50', () => {
    expect(part('a.stl', 20).id).not.toBe(part('a.stl', 20).id);
    expect(BATCH_MAX).toBe(50);
  });
});
