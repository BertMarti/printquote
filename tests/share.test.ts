import { describe, expect, it } from 'vitest';
import { applyPrinter } from '../src/quote/printers';
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings, type QuoteSettings } from '../src/quote/settings';
import { parseHash, SHARE_HASH_MAX, settingsToHash } from '../src/quote/share';

/** Ajustes distintos de los de por defecto en todo lo que viaja en el enlace. */
const WORKSHOP: QuoteSettings = normalizeSettings({
  ...applyPrinter(DEFAULT_SETTINGS, 'bambu-a1'),
  material: 'PETG',
  pricePerKg: { ...DEFAULT_SETTINGS.pricePerKg, PETG: 27.5 },
  infillPercent: 15,
  perimeters: 3,
  lineWidth: 0.4,
  overheadMinutes: 8,
  energyPrice: 0.22,
  marginPercent: 45,
  copies: 4,
});

describe('settingsToHash', () => {
  it('es legible y lleva versión, material, precio del material elegido y todos los parámetros', () => {
    expect(settingsToHash(WORKSHOP)).toBe(
      '#v=1&mat=PETG&price=27.5&printer=bambu-a1&infill=15&per=3&lw=0.4&flow=12&oh=8&pw=100&ep=0.22&mg=45&cp=4&bx=256&by=256&bz=256',
    );
  });

  it('no lleva nada que no sea un parámetro: ni pieza, ni cliente, ni datos del negocio, ni los precios de otros materiales', () => {
    const hash = settingsToHash(WORKSHOP);
    expect(hash).not.toMatch(/PLA|ABS|TPU|file|client|name|logo/i);
    expect(hash.length).toBeLessThan(200);
    // El precio de otro material no altera el enlace.
    const other = normalizeSettings({ ...WORKSHOP, pricePerKg: { ...WORKSHOP.pricePerKg, ABS: 99 } });
    expect(settingsToHash(other)).toBe(hash);
  });
});

describe('parseHash: ida y vuelta', () => {
  const roundTrip = (settings: QuoteSettings, base: QuoteSettings = DEFAULT_SETTINGS): QuoteSettings | null =>
    parseHash(settingsToHash(settings), base).settings;

  it('con los ajustes por defecto', () => {
    expect(roundTrip(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('con perfil de impresora y valores propios', () => {
    expect(roundTrip(WORKSHOP)).toEqual(WORKSHOP);
    expect(roundTrip(WORKSHOP)?.printerId).toBe('bambu-a1');
  });

  it('con valores extremos (en los límites)', () => {
    const extreme = normalizeSettings({
      ...DEFAULT_SETTINGS,
      material: 'TPU',
      pricePerKg: { ...DEFAULT_SETTINGS.pricePerKg, TPU: LIMITS.pricePerKg.max },
      infillPercent: 100,
      perimeters: 20,
      lineWidth: 0.1,
      flowRate: 200,
      powerWatts: 5000,
      energyPrice: 10,
      marginPercent: 1000,
      copies: 10000,
      bedX: 5000,
      bedY: 1,
      bedZ: 5000,
    });
    expect(roundTrip(extreme)).toEqual(extreme);
  });

  it('un valor guardado a mano que ya no coincide con el perfil vuelve a «Personalizada» (como en los ajustes)', () => {
    const hash = settingsToHash(WORKSHOP).replace('flow=12', 'flow=13');
    expect(parseHash(hash, DEFAULT_SETTINGS).settings?.printerId).toBe('custom');
  });
});

describe('parseHash: precios de otros materiales', () => {
  it('el enlace solo trae el precio del material elegido: los demás siguen siendo los de quien lo abre', () => {
    const mine = normalizeSettings({ ...DEFAULT_SETTINGS, pricePerKg: { PLA: 11, PETG: 12, ABS: 13, TPU: 14 } });
    const opened = parseHash(settingsToHash(WORKSHOP), mine).settings;
    expect(opened?.material).toBe('PETG');
    expect(opened?.pricePerKg).toEqual({ PLA: 11, PETG: 27.5, ABS: 13, TPU: 14 });
  });

  it('sin «price», el material elegido conserva el precio de quien lo abre', () => {
    const mine = normalizeSettings({ ...DEFAULT_SETTINGS, pricePerKg: { ...DEFAULT_SETTINGS.pricePerKg, ABS: 31 } });
    expect(parseHash('#v=1&mat=ABS', mine).settings?.pricePerKg.ABS).toBe(31);
  });
});

describe('parseHash: entrada rota u hostil (nunca lanza)', () => {
  const parse = (hash: string): ReturnType<typeof parseHash> => parseHash(hash, DEFAULT_SETTINGS);

  it('sin hash, vacío, solo «#» o sin versión: no hay ajustes', () => {
    for (const hash of ['', '#', '#mat=PETG', '#cualquier-cosa', '#/ruta', '#v=', '#=']) {
      expect(parse(hash), hash).toEqual({ settings: null, example: false });
    }
  });

  it('una versión desconocida se ignora entera', () => {
    for (const hash of ['#v=2&mat=PETG', '#v=0&mat=PETG', '#v=1.5&mat=PETG', '#v=abc&mat=PETG', '#v=-1&mat=PETG']) {
      expect(parse(hash).settings, hash).toBeNull();
    }
  });

  it('un hash de más de 1000 caracteres se ignora entero', () => {
    const long = `#v=1&mat=PETG&junk=${'a'.repeat(SHARE_HASH_MAX)}`;
    expect(long.length).toBeGreaterThan(SHARE_HASH_MAX);
    expect(parse(long)).toEqual({ settings: null, example: false });
    expect(parse(`#ejemplo&v=1&junk=${'a'.repeat(SHARE_HASH_MAX)}`)).toEqual({ settings: null, example: false });
    // En el límite exacto sí se lee.
    const exact = `#v=1&mat=PETG&junk=${'a'.repeat(SHARE_HASH_MAX - '#v=1&mat=PETG&junk='.length)}`;
    expect(exact.length).toBe(SHARE_HASH_MAX);
    expect(parse(exact).settings?.material).toBe('PETG');
  });

  it('valores no numéricos, vacíos o raros: se usan los de por defecto, sin lanzar', () => {
    const settings = parse('#v=1&infill=abc&per=&lw=0x10&flow=1e400&oh=NaN&pw=Infinity&ep=--1&mg=%00&cp=3.7&bx=%E2%82%AC').settings;
    expect(settings).not.toBeNull();
    expect(settings?.infillPercent).toBe(DEFAULT_SETTINGS.infillPercent);
    expect(settings?.perimeters).toBe(DEFAULT_SETTINGS.perimeters);
    expect(settings?.lineWidth).toBe(DEFAULT_SETTINGS.lineWidth);
    expect(settings?.flowRate).toBe(DEFAULT_SETTINGS.flowRate);
    expect(settings?.overheadMinutes).toBe(DEFAULT_SETTINGS.overheadMinutes);
    expect(settings?.powerWatts).toBe(DEFAULT_SETTINGS.powerWatts);
    expect(settings?.energyPrice).toBe(DEFAULT_SETTINGS.energyPrice);
    expect(settings?.marginPercent).toBe(DEFAULT_SETTINGS.marginPercent);
    expect(settings?.bedX).toBe(DEFAULT_SETTINGS.bedX);
    expect(settings?.copies).toBe(4); // los enteros se redondean como en los ajustes
  });

  it('valores fuera de rango se acotan; material o impresora desconocidos, por defecto', () => {
    const settings = parse('#v=1&mat=XX&printer=nadie&infill=5000&per=-3&cp=0&mg=99999&bz=-5&price=-1').settings;
    expect(settings?.material).toBe(DEFAULT_SETTINGS.material);
    expect(settings?.printerId).toBe('custom');
    expect(settings?.infillPercent).toBe(100);
    expect(settings?.perimeters).toBe(0);
    expect(settings?.copies).toBe(1);
    expect(settings?.marginPercent).toBe(1000);
    expect(settings?.bedZ).toBe(LIMITS.bedZ.min);
    expect(settings?.pricePerKg.PLA).toBe(0);
  });

  it('claves desconocidas, repetidas o con nombres de Object se ignoran (la primera repetida gana)', () => {
    const settings = parse('#v=1&mat=PETG&mat=ABS&__proto__=1&constructor=2&toString=3&hasOwnProperty=4&x[y]=5').settings;
    expect(settings?.material).toBe('PETG');
    expect(Object.keys(settings ?? {}).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('texto con caracteres de control, HTML o codificaciones inválidas no rompe nada', () => {
    for (const hash of ['#v=1&mat=%', '#v=1&mat=%E0%A4%A', '#v=1&mat=<script>alert(1)</script>', '#v=1&printer=%00%01', '\u0000#v=1']) {
      expect(() => parse(hash), hash).not.toThrow();
    }
    expect(parse('#v=1&mat=<script>alert(1)</script>').settings?.material).toBe('PLA');
  });
});

describe('parseHash: #ejemplo', () => {
  it('«#ejemplo» solo pide la pieza de ejemplo, sin ajustes', () => {
    expect(parseHash('#ejemplo', DEFAULT_SETTINGS)).toEqual({ settings: null, example: true });
  });

  it('«#ejemplo&…» pide la pieza de ejemplo y aplica los ajustes', () => {
    const result = parseHash('#ejemplo&v=1&mat=ABS&cp=2', DEFAULT_SETTINGS);
    expect(result.example).toBe(true);
    expect(result.settings?.material).toBe('ABS');
    expect(result.settings?.copies).toBe(2);
  });

  it('el orden no importa, y «ejemplo» como valor de otra clave no cuenta', () => {
    expect(parseHash('#v=1&ejemplo&mat=ABS', DEFAULT_SETTINGS).example).toBe(true);
    expect(parseHash('#v=1&mat=ejemplo', DEFAULT_SETTINGS).example).toBe(false);
    expect(parseHash('#ejemplos', DEFAULT_SETTINGS).example).toBe(false);
  });
});
