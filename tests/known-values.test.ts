import { describe, expect, it } from 'vitest';
import { analyzeModel } from '../src/stl/analyze';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { asciiStl, binaryStl, cubeTriangles, encode } from './helpers/mesh';

/** Cubo de 20 mm escrito a mano: 8 vértices y 12 triángulos con las normales hacia fuera. */
const CUBE_OBJ = `# cubo de 20 mm: 8 vértices, 12 triángulos
v 0 0 0
v 20 0 0
v 20 20 0
v 0 20 0
v 0 0 20
v 20 0 20
v 20 20 20
v 0 20 20
f 1 4 3
f 1 3 2
f 5 6 7
f 5 7 8
f 1 2 6
f 1 6 5
f 2 3 7
f 2 7 6
f 3 4 8
f 3 8 7
f 4 1 5
f 4 5 8
`;

const FORMATS: ReadonlyArray<readonly [string, () => ArrayBuffer | Uint8Array, string]> = [
  ['STL binario', () => binaryStl(cubeTriangles(20)), 'cubo.stl'],
  ['STL ASCII', () => encode(asciiStl(cubeTriangles(20))), 'cubo.stl'],
  ['OBJ', () => encode(CUBE_OBJ), 'cubo.obj'],
];

/** (cáscara 2400 × 0,9) + (relleno 20 % de 8000 − 2160) */
const EXPECTED_PRINTED_VOLUME = 2400 * 0.9 + 0.2 * (8000 - 2400 * 0.9);
const EXPECTED_HOURS = (EXPECTED_PRINTED_VOLUME / 8 + 300) / 3600;

describe('cubo de 20 mm: geometría conocida en los tres formatos', () => {
  it.each(FORMATS)('%s da volumen 8000 mm³, área 2400 mm² y la malla cerrada', async (_name, make, fileName) => {
    const { mesh, stats } = await analyzeModel(make(), fileName);
    expect(mesh.triangleCount).toBe(12);
    expect(stats.volume).toBeCloseTo(8000, 3);
    expect(stats.signedVolume).toBeGreaterThan(0); // normales hacia fuera
    expect(stats.surfaceArea).toBeCloseTo(2400, 3);
    expect(stats.openEdges).toBe(0);
  });

  it('los tres formatos dan exactamente los mismos números', async () => {
    const binario = await analyzeModel(binaryStl(cubeTriangles(20)), 'cubo.stl');
    const ascii = await analyzeModel(encode(asciiStl(cubeTriangles(20))), 'cubo.stl');
    const obj = await analyzeModel(encode(CUBE_OBJ), 'cubo.obj');

    expect(ascii.stats.volume).toBeCloseTo(binario.stats.volume, 6);
    expect(obj.stats.volume).toBeCloseTo(binario.stats.volume, 6);
    expect(ascii.stats.surfaceArea).toBeCloseTo(binario.stats.surfaceArea, 6);
    expect(obj.stats.surfaceArea).toBeCloseTo(binario.stats.surfaceArea, 6);
    expect(obj.stats.openEdges).toBe(binario.stats.openEdges);

    const quoteBinario = computeQuote(binario.stats, DEFAULT_SETTINGS);
    const quoteAscii = computeQuote(ascii.stats, DEFAULT_SETTINGS);
    const quoteObj = computeQuote(obj.stats, DEFAULT_SETTINGS);
    expect(quoteAscii.printedVolume).toBeCloseTo(quoteBinario.printedVolume, 6);
    expect(quoteObj.printedVolume).toBeCloseTo(quoteBinario.printedVolume, 6);
    expect(quoteAscii.total).toBeCloseTo(quoteBinario.total, 6);
    expect(quoteObj.total).toBeCloseTo(quoteBinario.total, 6);
  });
});

describe('presupuesto conocido con DEFAULT_SETTINGS (PLA, 20 % de relleno)', () => {
  it.each(FORMATS)('%s presupuesta: 3328 mm³, 4,12672 g, 0,08 € de material y 0,10 € de total', async (_name, make, fileName) => {
    const { stats } = await analyzeModel(make(), fileName);
    const quote = computeQuote(stats, DEFAULT_SETTINGS);

    expect(quote.printedVolume).toBeCloseTo(EXPECTED_PRINTED_VOLUME, 3); // 3328
    expect(quote.shellVolume).toBeCloseTo(2160, 3);
    expect(quote.infillVolume).toBeCloseTo(1168, 3);
    expect(quote.weightGrams).toBeCloseTo(4.12672, 5); // 3,328 cm³ × 1,24 g/cm³
    expect(quote.hoursPerCopy).toBeCloseTo(EXPECTED_HOURS, 6);
    expect(quote.materialCost).toBeCloseTo(0.08, 6);
    expect(quote.total).toBeCloseTo(0.1, 6);
  });

  it('el desglose suma el total (redondeo por líneas)', async () => {
    const { stats } = await analyzeModel(binaryStl(cubeTriangles(20)), 'cubo.stl');
    const quote = computeQuote(stats, DEFAULT_SETTINGS);
    expect(quote.subtotal).toBeCloseTo(quote.materialCost + quote.energyCost, 6);
    expect(quote.total).toBeCloseTo(quote.subtotal + quote.marginAmount, 6);
    expect(quote.copies).toBe(1);
    expect(quote.energyCost).toBe(0); // 0,024 kWh × 0,15 € = 0,0036 € → se redondea a 0,00 €
  });
});
