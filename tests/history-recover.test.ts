import { describe, expect, it } from 'vitest';
import { makePart } from '../src/quote/batch';
import { partToHistory, recoverSurface, type HistoryPart } from '../src/quote/history';
import { DEFAULT_SETTINGS, type QuoteSettings } from '../src/quote/settings';
import type { MeshStats } from '../src/stl/types';

/** Pieza «de v0.6»: lo que se guardaba entonces (todo menos `surfaceMm2`). */
function oldPart(volume: number, surface: number, patch: Partial<QuoteSettings> = {}): { saved: HistoryPart; surface: number } {
  const stats: MeshStats = {
    triangleCount: 100,
    volume,
    signedVolume: volume,
    surfaceArea: surface,
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 }, size: { x: 10, y: 10, z: 10 } },
    openEdges: 0,
  };
  const { surfaceMm2, ...saved } = partToHistory(makePart('pieza.stl', stats, { ...DEFAULT_SETTINGS, ...patch }));
  expect(surfaceMm2).toBe(surface);
  return { saved, surface };
}

describe('recoverSurface (lotes de v0.6 sin área)', () => {
  it('deduce el área con varios materiales, rellenos, perímetros y copias', () => {
    const cases: Partial<QuoteSettings>[] = [
      {},
      { material: 'PETG', infillPercent: 40, copies: 3 },
      { material: 'TPU', perimeters: 4, lineWidth: 0.6, infillPercent: 5 },
      { material: 'ABS', infillPercent: 0, copies: 25 },
    ];
    for (const patch of cases) {
      const { saved, surface } = oldPart(48_000, 9_100, patch);
      expect(recoverSurface(saved)).toBeCloseTo(surface, 3);
    }
  });

  it('si el área no influye (relleno 100 %, sin pared o cáscara que llena la pieza) da un valor que reproduce el resultado', () => {
    for (const [volume, surface, patch] of [
      [8_000, 2_400, { infillPercent: 100 }],
      [8_000, 2_400, { perimeters: 0 }],
      [500, 50_000, { infillPercent: 20 }], // pieza fina: la cáscara ocupa todo
    ] as const) {
      const { saved } = oldPart(volume, surface, patch);
      expect(recoverSurface(saved)).not.toBeNull();
    }
  });

  it('rechaza un resultado manipulado, un peso imposible o un volumen nulo', () => {
    const { saved } = oldPart(48_000, 9_100);
    expect(recoverSurface({ ...saved, result: { ...saved.result, total: saved.result.total + 0.01 } })).toBeNull();
    expect(recoverSurface({ ...saved, result: { ...saved.result, weightGrams: saved.result.weightGrams * 3 } })).toBeNull();
    expect(recoverSurface({ ...saved, result: { ...saved.result, hours: saved.result.hours + 1 } })).toBeNull();
    expect(recoverSurface({ ...saved, volumeMm3: 0 })).toBeNull();
  });
});
