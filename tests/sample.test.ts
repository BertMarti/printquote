import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeStats, meshWarnings } from '../src/stl/geometry';
import { parseStl } from '../src/stl/parse';

describe('pieza de ejemplo', () => {
  it('es un STL binario cerrado, bien orientado y que cabe en la cama por defecto', () => {
    const file = fileURLToPath(new URL('../public/samples/soporte-movil.stl', import.meta.url));
    const mesh = parseStl(new Uint8Array(readFileSync(file)));
    const stats = computeStats(mesh);

    expect(mesh.format).toBe('binary');
    expect(stats.openEdges).toBe(0);
    expect(stats.signedVolume).toBeGreaterThan(0);
    expect(meshWarnings(stats)).toEqual([]);
  });
});
