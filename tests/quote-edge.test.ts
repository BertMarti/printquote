import { describe, expect, it } from 'vitest';
import { formatDuration, formatEuro, formatNumber, parseDecimal } from '../src/quote/format';
import { MATERIAL_IDS } from '../src/quote/materials';
import { computeQuote, type Quote } from '../src/quote/model';
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings, type QuoteSettings } from '../src/quote/settings';

const HARD_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g');
const plain = (text: string): string => text.replace(HARD_SPACES, ' ');
/** Céntimos tal y como se ven en pantalla (formatNumber con 2 decimales). */
const shownCents = (value: number): number => Math.round(Number(formatNumber(value, 2).replace(/\./g, '').replace(',', '.')) * 100);

/** Generador pseudoaleatorio reproducible. */
function random(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const MONEY_KEYS = ['materialCost', 'energyCost', 'subtotal', 'marginAmount', 'total', 'totalPerCopy'] as const;

describe('redondeo del desglose', () => {
  it('lo que se ve cuadra: material + energía = subtotal y subtotal + margen = total (500 casos)', () => {
    const next = random(42);
    for (let i = 0; i < 500; i++) {
      const settings = normalizeSettings({
        material: MATERIAL_IDS[i % 4],
        infillPercent: next() * 100,
        marginPercent: next() * 200,
        copies: 1 + Math.floor(next() * 20),
        powerWatts: next() * 400,
        energyPrice: next() * 0.5,
      });
      const volume = next() * 200_000;
      const q = computeQuote({ volume, surfaceArea: Math.cbrt(volume) ** 2 * 6 }, settings);
      expect(shownCents(q.materialCost) + shownCents(q.energyCost)).toBe(shownCents(q.subtotal));
      expect(shownCents(q.subtotal) + shownCents(q.marginAmount)).toBe(shownCents(q.total));
    }
  });

  it('los importes son céntimos exactos (lo que se copia, imprime y ve es lo mismo)', () => {
    const q = computeQuote({ volume: 8000, surfaceArea: 2400 }, { ...DEFAULT_SETTINGS, copies: 3 });
    for (const key of MONEY_KEYS) {
      expect(Math.round(q[key] * 100) / 100).toBe(q[key]);
    }
  });

  it('medio céntimo se redondea hacia arriba pese a la coma flotante (1,005 → 1,01)', () => {
    // 1,005 € de material: 1 kg a 1,005 €/kg con relleno 100 % y sin cáscara.
    const settings: QuoteSettings = {
      ...DEFAULT_SETTINGS,
      material: 'PLA',
      pricePerKg: { ...DEFAULT_SETTINGS.pricePerKg, PLA: 1.005 },
      infillPercent: 100,
      perimeters: 0,
      powerWatts: 0,
      marginPercent: 0,
    };
    const q = computeQuote({ volume: 1_000_000 / 1.24, surfaceArea: 0 }, settings);
    expect(q.materialCost).toBe(1.01);
  });
});

describe('valores extremos', () => {
  const extremes: Array<[string, Partial<QuoteSettings>]> = [
    ['mínimos', Object.fromEntries(Object.entries(LIMITS).filter(([k]) => k !== 'pricePerKg').map(([k, l]) => [k, l.min]))],
    ['máximos', Object.fromEntries(Object.entries(LIMITS).filter(([k]) => k !== 'pricePerKg').map(([k, l]) => [k, l.max]))],
  ];

  it.each(extremes)('con los ajustes en sus %s y piezas de 0 a 1e40 mm³, todo es finito y ≥ 0', (_name, patch) => {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...patch });
    for (const volume of [0, 1e-9, 1, 1e9, 1e40]) {
      const q: Quote = computeQuote({ volume, surfaceArea: volume * 10 }, settings);
      for (const [key, value] of Object.entries(q)) {
        expect(Number.isFinite(value), key).toBe(true);
        expect(value, key).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ni NaN ni «Infinity» llegan al texto formateado', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatNumber(bad, 2)).toBe('0,00');
      expect(plain(formatEuro(bad))).toBe('0,00 €');
      expect(formatDuration(bad)).toBe('0 min');
    }
  });

  it('ningún importe se muestra como «-0,00 €»', () => {
    expect(plain(formatEuro(-0))).toBe('0,00 €');
    expect(plain(formatEuro(-0.001))).toBe('0,00 €');
    expect(formatNumber(-0.001, 2)).toBe('0,00');
  });

  it('duraciones enormes siguen siendo legibles', () => {
    expect(plain(formatDuration(12345.5))).toBe('12.345 h 30 min');
  });
});

describe('parseDecimal · entradas raras', () => {
  it.each([
    ['', Number.NaN],
    ['   ', Number.NaN],
    ['-', Number.NaN],
    ['.', Number.NaN],
    [',', Number.NaN],
    ['1.000,5', Number.NaN],
    ['1,000.5', Number.NaN],
    ['Infinity', Number.NaN],
    ['NaN', Number.NaN],
    ['0x10', Number.NaN],
    ['12 kg', Number.NaN],
    ['doce', Number.NaN],
    ['-3', -3],
    ['+2,5', 2.5],
    ['5,', 5],
    [' 1 000 ', 1000],
    ['0,000', 0],
  ])('«%s» → %s', (input, expected) => {
    expect(parseDecimal(input)).toBe(expected);
  });
});
