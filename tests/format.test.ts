import { describe, expect, it } from 'vitest';
import { formatDuration, formatEuro, formatNumber, parseDecimal } from '../src/quote/format';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { buildQuoteText } from '../src/quote/text';

/** Intl usa espacios duros; para comparar, los normalizamos. */
const HARD_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g');
const plain = (text: string): string => text.replace(HARD_SPACES, ' ');

describe('formato es-ES', () => {
  it('coma decimal', () => {
    expect(formatNumber(3.14159, 2)).toBe('3,14');
    expect(formatNumber(2, 1)).toBe('2,0');
  });

  it('euros con el símbolo detrás', () => {
    expect(plain(formatEuro(12.3))).toBe('12,30 €');
    expect(plain(formatEuro(0.004))).toBe('0,00 €');
  });

  it('valores no finitos se muestran como 0', () => {
    expect(formatNumber(Number.NaN, 1)).toBe('0,0');
  });

  it('duraciones', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(0.005)).toBe('< 1 min');
    expect(formatDuration(0.75)).toBe('45 min');
    expect(formatDuration(2 + 5 / 60)).toBe('2 h 05 min');
  });
});

describe('parseDecimal', () => {
  it('acepta coma o punto', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal(' 0.45 ')).toBe(0.45);
    expect(parseDecimal('20')).toBe(20);
    expect(parseDecimal(',5')).toBe(0.5);
  });

  it('rechaza lo que no es un número', () => {
    expect(parseDecimal('')).toBeNaN();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('1,2,3')).toBeNaN();
    expect(parseDecimal('1e3')).toBeNaN();
  });
});

describe('buildQuoteText', () => {
  const stats = {
    triangleCount: 12,
    volume: 8000,
    signedVolume: 8000,
    surfaceArea: 2400,
    openEdges: 0,
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 20, z: 20 }, size: { x: 20, y: 20, z: 20 } },
  };

  it('incluye pieza, ajustes, desglose, total y la advertencia de estimación', () => {
    const settings = { ...DEFAULT_SETTINGS, copies: 2 };
    const quote = computeQuote(stats, settings);
    const text = plain(buildQuoteText({ fileName: 'cubo.stl', stats, settings, quote, date: new Date(2026, 8, 29) }));

    expect(text).toContain('cubo.stl');
    expect(text).toContain('29 de septiembre de 2026');
    expect(text).toContain('20,0 × 20,0 × 20,0 mm');
    expect(text).toContain('8,00 cm³');
    expect(text).toContain('Tiempo total (estimación)');
    // Material 0,17 + energía 0,01 = 0,18; margen 0,054 → 0,05; total 0,23 (suma de líneas en céntimos)
    expect(text).toMatch(/Subtotal\s+0,18 €/);
    expect(text).toMatch(/TOTAL\s+0,23 €/);
    expect(text).toContain('Por copia');
  });
});
