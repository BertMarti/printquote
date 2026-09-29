import { describe, expect, it } from 'vitest';
import { computeQuote, printedVolume, wallThickness } from '../src/quote/model';
import { DEFAULT_SETTINGS, normalizeSettings, type QuoteSettings } from '../src/quote/settings';

/** Cubo de 20 mm. */
const CUBE = { volume: 8000, surfaceArea: 2400 };

function settings(overrides: Partial<QuoteSettings> = {}): QuoteSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('printedVolume', () => {
  it('grosor de pared = perímetros × ancho de línea', () => {
    expect(wallThickness({ perimeters: 2, lineWidth: 0.45 })).toBeCloseTo(0.9);
  });

  it('relleno 0 %: solo la cáscara', () => {
    const v = printedVolume(CUBE, settings({ infillPercent: 0 }));
    expect(v.shell).toBeCloseTo(2400 * 0.9); // 2160 mm³
    expect(v.infill).toBe(0);
    expect(v.total).toBeCloseTo(2160);
  });

  it('relleno 100 %: la pieza entera', () => {
    const v = printedVolume(CUBE, settings({ infillPercent: 100 }));
    expect(v.total).toBeCloseTo(8000);
  });

  it('relleno 20 %: cáscara + 20 % del interior', () => {
    const v = printedVolume(CUBE, settings({ infillPercent: 20 }));
    expect(v.infill).toBeCloseTo(0.2 * (8000 - 2160));
    expect(v.total).toBeCloseTo(3328);
  });

  it('la cáscara nunca supera el volumen de la pieza (piezas finas)', () => {
    // Placa de 100 × 100 × 0,5 mm: área × grosor sería mucho mayor que el volumen.
    const plate = { volume: 5000, surfaceArea: 2 * 100 * 100 + 4 * 100 * 0.5 };
    const v = printedVolume(plate, settings({ infillPercent: 0, perimeters: 3 }));
    expect(v.shell).toBe(5000);
    expect(v.total).toBe(5000);
  });

  it('sin perímetros, el volumen impreso es solo relleno', () => {
    const v = printedVolume(CUBE, settings({ perimeters: 0, infillPercent: 50 }));
    expect(v.shell).toBe(0);
    expect(v.total).toBeCloseTo(4000);
  });
});

describe('computeQuote', () => {
  it('cubo de 20 mm con los valores por defecto (PLA, 20 %, 2 perímetros)', () => {
    const q = computeQuote(CUBE, settings());
    // 3328 mm³ × 1,24 g/cm³ = 4,12672 g
    expect(q.printedVolume).toBeCloseTo(3328);
    expect(q.weightGrams).toBeCloseTo(4.12672, 5);
    // 4,12672 g × 20 €/kg = 0,0825 € → 0,08 € (los importes van en céntimos)
    expect(q.materialCost).toBe(0.08);
    // 3328 / 8 = 416 s + 300 s de sobrecarga = 716 s
    expect(q.hoursPerCopy).toBeCloseTo(716 / 3600, 9);
    // 120 W × 716 s = 0,023867 kWh × 0,15 €/kWh
    expect(q.energyKwh).toBeCloseTo((120 * 716) / 3600 / 1000, 9);
    // 0,00358 € → 0,00 €
    expect(q.energyCost).toBe(0);
    expect(q.subtotal).toBe(0.08);
    // 30 % de 0,08 = 0,024 → 0,02; total = suma de líneas redondeadas
    expect(q.marginAmount).toBe(0.02);
    expect(q.total).toBe(0.1);
  });

  it('relleno 100 % en PETG: peso de la pieza maciza con su densidad y precio', () => {
    const q = computeQuote(CUBE, settings({ material: 'PETG', infillPercent: 100 }));
    expect(q.weightGrams).toBeCloseTo(8 * 1.27, 9);
    // 10,16 g × 24 €/kg = 0,24384 €
    expect(q.materialCost).toBe(0.24);
  });

  it('usa el precio del material elegido, no el de otro', () => {
    const prices = { ...DEFAULT_SETTINGS.pricePerKg, TPU: 50 };
    const q = computeQuote(CUBE, settings({ material: 'TPU', infillPercent: 100, pricePerKg: prices }));
    // 9,68 g × 50 €/kg = 0,484 €
    expect(q.materialCost).toBe(0.48);
  });

  it('las copias multiplican peso, tiempo, energía y total; el precio por copia no cambia', () => {
    const one = computeQuote(CUBE, settings());
    const three = computeQuote(CUBE, settings({ copies: 3 }));
    expect(three.copies).toBe(3);
    expect(three.totalWeightGrams).toBeCloseTo(one.totalWeightGrams * 3, 9);
    expect(three.totalHours).toBeCloseTo(one.totalHours * 3, 9);
    expect(three.energyKwh).toBeCloseTo(one.energyKwh * 3, 9);
    // Los importes se redondean después de multiplicar: 3 × 0,0825 € = 0,2476 € → 0,25 €
    // (no 3 × 0,08 €), así que el total de 3 copias no es exactamente 3 × el de una.
    expect(three.materialCost).toBe(0.25);
    expect(three.total).toBe(0.34);
    expect(three.totalPerCopy).toBe(0.11);
    expect(Math.abs(three.total - one.total * 3)).toBeLessThanOrEqual(0.05);
  });

  it('margen 0 %: total = coste; margen 100 %: total = el doble', () => {
    const zero = computeQuote(CUBE, settings({ marginPercent: 0 }));
    expect(zero.marginAmount).toBe(0);
    expect(zero.total).toBe(zero.subtotal);
    const double = computeQuote(CUBE, settings({ marginPercent: 100 }));
    expect(double.total).toBe(double.subtotal * 2);
  });

  it('pieza vacía: solo cuesta la sobrecarga fija de tiempo y su energía', () => {
    const q = computeQuote({ volume: 0, surfaceArea: 0 }, settings({ marginPercent: 0 }));
    expect(q.weightGrams).toBe(0);
    expect(q.materialCost).toBe(0);
    expect(q.hoursPerCopy).toBeCloseTo(5 / 60, 12);
    // 0,12 kW × 5 min × 0,15 €/kWh = 0,0015 € → 0,00 €
    expect(q.energyKwh).toBeCloseTo(0.12 * (5 / 60), 12);
    expect(q.total).toBe(0);
  });
});

describe('normalizeSettings', () => {
  it('sin datos devuelve los valores por defecto', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('basura')).toEqual(DEFAULT_SETTINGS);
  });

  it('conserva lo válido, descarta lo no válido y limita rangos', () => {
    const s = normalizeSettings({
      material: 'ABS',
      infillPercent: 150,
      perimeters: 2.6,
      copies: 0,
      flowRate: 'rápido',
      energyPrice: Number.NaN,
      pricePerKg: { ABS: 30, PLA: -5 },
    });
    expect(s.material).toBe('ABS');
    expect(s.infillPercent).toBe(100);
    expect(s.perimeters).toBe(3);
    expect(s.copies).toBe(1);
    expect(s.flowRate).toBe(DEFAULT_SETTINGS.flowRate);
    expect(s.energyPrice).toBe(DEFAULT_SETTINGS.energyPrice);
    expect(s.pricePerKg).toEqual({ PLA: 0, PETG: 24, ABS: 30, TPU: 35 });
  });

  it('material desconocido → PLA', () => {
    expect(normalizeSettings({ material: 'Nylon' }).material).toBe('PLA');
  });
});
