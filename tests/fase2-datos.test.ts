// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildQuoteDocument } from '../src/pdf/document';
import { BACKUP_MAX_BYTES, buildBackup, parseBackup } from '../src/quote/backup';
import { DEFAULT_BUSINESS, normalizeBusiness } from '../src/quote/business';
import { computeQuote } from '../src/quote/model';
import {
  applyMaterialPreset,
  applyPrinterPreset,
  materialPresetFrom,
  normalizeMaterialPresets,
  normalizePrinterPresets,
  PRESETS_MAX,
  printerPresetFrom,
  upsertPreset,
} from '../src/quote/profiles';
import { DEFAULT_SETTINGS, LIMITS } from '../src/quote/settings';
import { computeStats } from '../src/stl/geometry';
import {
  clearAllData,
  loadBatch,
  loadBusiness,
  loadHistory,
  loadProfiles,
  loadSettings,
  saveProfiles,
  takeStorageIssues,
} from '../src/ui/storage';
import { cubeTriangles, toPositions } from './helpers/mesh';

/** Valor que el test sabe que existe (sin `!`, que el lint prohíbe). */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('falta un valor');
  return value;
}

beforeEach(() => {
  localStorage.clear();
  takeStorageIssues();
});
afterEach(() => localStorage.clear());

describe('lo leído de localStorage se valida (el origen bertmarti.github.io es compartido)', () => {
  it('JSON roto en cada clave: valores por defecto y aviso de cada parte', () => {
    for (const key of ['ajustes', 'negocio', 'historial', 'lote', 'perfiles']) localStorage.setItem(`printquote:${key}:v1`, '{roto');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadBusiness()).toEqual(normalizeBusiness(undefined));
    expect(loadHistory()).toEqual([]);
    expect(loadBatch()).toEqual([]);
    expect(loadProfiles()).toEqual({ printers: [], materials: [] });
    expect(takeStorageIssues().sort()).toEqual(['batch', 'business', 'history', 'profiles', 'settings']);
    expect(takeStorageIssues()).toEqual([]); // se olvidan tras leerlos
  });

  it('sin nada guardado no hay aviso', () => {
    loadSettings();
    loadBusiness();
    loadHistory();
    loadBatch();
    loadProfiles();
    expect(takeStorageIssues()).toEqual([]);
  });

  it('tipos equivocados (un array, un número) también avisan', () => {
    localStorage.setItem('printquote:ajustes:v1', '[1,2]');
    localStorage.setItem('printquote:historial:v1', '{"a":1}');
    localStorage.setItem('printquote:negocio:v1', '42');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadHistory()).toEqual([]);
    loadBusiness();
    expect(takeStorageIssues().sort()).toEqual(['business', 'history', 'settings']);
  });

  it('valores manipulados se acotan a su rango y no se cuela nada que no sea de printquote', () => {
    localStorage.setItem(
      'printquote:ajustes:v1',
      JSON.stringify({ infillPercent: 1e9, flowRate: -5, material: '<img src=x onerror=alert(1)>', __proto__: { polluted: 1 } }),
    );
    const settings = loadSettings();
    expect(settings.infillPercent).toBe(LIMITS.infillPercent.max);
    expect(settings.flowRate).toBe(LIMITS.flowRate.min);
    expect(settings.material).toBe(DEFAULT_SETTINGS.material);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('un logotipo que no es una imagen PNG/JPEG en base64 se descarta y se avisa', () => {
    localStorage.setItem('printquote:negocio:v1', JSON.stringify({ name: 'Taller', logo: 'javascript:alert(1)' }));
    const business = loadBusiness();
    expect(business.logo).toBeNull();
    expect(business.name).toBe('Taller');
    expect(takeStorageIssues()).toEqual(['business']);
  });

  it('notas del negocio: sin caracteres de control y con longitud máxima', () => {
    const business = normalizeBusiness({ notes: `Pago\u0000 por transferencia\n${'x'.repeat(400)}`, pdfShowCosts: 'true' });
    expect(business.notes.includes('\u0000')).toBe(false);
    expect(business.notes.length).toBe(300);
    expect(business.pdfShowCosts).toBe(false); // solo `true` de verdad lo activa
  });

  it('perfiles: los rotos se descartan, se avisa y se respeta el máximo', () => {
    const good = { name: 'Ender 3', flowRate: 9, powerWatts: 110, bedX: 220, bedY: 220, bedZ: 250, lineWidth: 0.45, perimeters: 2, overheadMinutes: 5 };
    localStorage.setItem(
      'printquote:perfiles:v1',
      JSON.stringify({ v: 1, printers: [good, { ...good, name: '' }, { ...good, name: 'Mala', flowRate: 'mucho' }], materials: [] }),
    );
    expect(loadProfiles().printers.map((p) => p.name)).toEqual(['Ender 3']);
    expect(takeStorageIssues()).toEqual(['profiles']);

    const many = Array.from({ length: PRESETS_MAX + 5 }, (_, i) => ({ ...good, name: `P${i}` }));
    expect(normalizePrinterPresets(many)).toHaveLength(PRESETS_MAX);
    expect(normalizePrinterPresets([good, { ...good, name: 'ender 3' }])).toHaveLength(1); // repetido sin mayúsculas
    localStorage.setItem('printquote:perfiles:v1', JSON.stringify({ v: 1, printers: many }));
    expect(loadProfiles().printers).toHaveLength(PRESETS_MAX);
    expect(takeStorageIssues()).toEqual(['profiles']); // la app nunca guarda más del máximo
    expect(normalizeMaterialPresets([{ name: 'X', material: 'NYLON', pricePerKg: 20 }])).toEqual([]);
  });

  it('guardar y leer perfiles, y aplicar impresora y material', () => {
    const settings = { ...DEFAULT_SETTINGS, flowRate: 14, bedX: 300, material: 'PETG' as const };
    const printer = printerPresetFrom(settings, '  Mi\tVoron  ');
    const material = materialPresetFrom({ ...settings, pricePerKg: { ...settings.pricePerKg, PETG: 18.5 } }, 'PETG barato');
    expect(printer?.name).toBe('Mi Voron');
    expect(saveProfiles({ printers: [must(printer)], materials: [must(material)] })).toBe(true);
    expect(loadProfiles()).toEqual({ printers: [printer], materials: [material] });

    const applied = applyMaterialPreset(applyPrinterPreset(DEFAULT_SETTINGS, must(printer)), must(material));
    expect(applied.flowRate).toBe(14);
    expect(applied.bedX).toBe(300);
    expect(applied.printerId).toBe('custom');
    expect(applied.material).toBe('PETG');
    expect(applied.pricePerKg.PETG).toBe(18.5);
    expect(applied.pricePerKg.PLA).toBe(DEFAULT_SETTINGS.pricePerKg.PLA);

    const full = Array.from({ length: PRESETS_MAX }, (_, i) => ({ ...must(printer), name: `P${i}` }));
    expect(upsertPreset(full, { ...must(printer), name: 'Nueva' })).toBeNull();
    expect(upsertPreset(full, { ...must(printer), name: 'p3', flowRate: 1 })?.[0]?.flowRate).toBe(1); // reemplaza
  });

  it('«Borrar mis datos» solo quita las claves de printquote, no las de otras webs del mismo origen', () => {
    localStorage.setItem('printquote:ajustes:v1', '{}');
    localStorage.setItem('printquote:negocio:v1', '{}');
    localStorage.setItem('printquote:bienvenida:v1', '1');
    localStorage.setItem('otra-app:token', 'no tocar');
    localStorage.setItem('printquoteX', 'tampoco');
    expect(clearAllData()).toBe(3);
    expect(localStorage.getItem('otra-app:token')).toBe('no tocar');
    expect(localStorage.getItem('printquoteX')).toBe('tampoco');
    expect(localStorage.getItem('printquote:ajustes:v1')).toBeNull();
  });
});

describe('exportar e importar ajustes', () => {
  const printer = must(printerPresetFrom(DEFAULT_SETTINGS, 'Mía'));

  it('ida y vuelta conserva ajustes, perfiles y negocio', () => {
    const business = { ...DEFAULT_BUSINESS, name: 'Taller', notes: 'Pago a 30 días' };
    const text = buildBackup({ settings: { ...DEFAULT_SETTINGS, infillPercent: 35 }, printers: [printer], materials: [], business });
    const result = parseBackup(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.settings?.infillPercent).toBe(35);
    expect(result.data.printers).toEqual([printer]);
    expect(result.data.business).toEqual(business);
    expect(result.dropped).toBe(0);
  });

  it('sin negocio, el negocio no viaja', () => {
    const result = parseBackup(buildBackup({ settings: DEFAULT_SETTINGS, printers: [], materials: [], business: null }));
    expect(result.ok && result.data.business).toBeNull();
  });

  it('rechaza lo que no es suyo, lo roto, otras versiones y lo enorme', () => {
    expect(parseBackup('no es json')).toEqual({ ok: false, error: 'backup.err.json' });
    expect(parseBackup('[]')).toEqual({ ok: false, error: 'backup.err.notOurs' });
    expect(parseBackup('{"app":"otra","v":1}')).toEqual({ ok: false, error: 'backup.err.notOurs' });
    expect(parseBackup('{"app":"printquote","v":2,"settings":{}}')).toEqual({ ok: false, error: 'backup.err.version' });
    expect(parseBackup('{"app":"printquote","v":1}')).toEqual({ ok: false, error: 'backup.err.empty' });
    expect(parseBackup(' '.repeat(BACKUP_MAX_BYTES + 1))).toEqual({ ok: false, error: 'backup.err.tooBig' });
    // Menos caracteres que el máximo, pero más bytes en UTF-8 («€» ocupa 3).
    expect(parseBackup('€'.repeat(BACKUP_MAX_BYTES / 2))).toEqual({ ok: false, error: 'backup.err.tooBig' });
  });

  it('acepta el BOM de UTF-8 y normaliza valores manipulados', () => {
    const text = '﻿' + JSON.stringify({
      app: 'printquote',
      v: 1,
      settings: { copies: -3, marginPercent: 'mucho' },
      printers: [printer, { name: 'rota' }],
      business: { name: 'x'.repeat(500), logo: 'data:text/html;base64,PHNjcmlwdD4=' },
    });
    const result = parseBackup(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.settings?.copies).toBe(LIMITS.copies.min);
    expect(result.data.settings?.marginPercent).toBe(DEFAULT_SETTINGS.marginPercent);
    expect(result.data.printers).toEqual([printer]);
    expect(result.dropped).toBe(1);
    expect(result.data.business?.name).toHaveLength(80);
    expect(result.data.business?.logo).toBeNull();
    expect(result.data.materials).toBeNull(); // no venía: no se toca lo que haya
  });
});

describe('PDF pensado para el cliente final', () => {
  const stats = computeStats({ positions: toPositions(cubeTriangles(20)), triangleCount: 12, format: 'binary' });
  const settings = { ...DEFAULT_SETTINGS, copies: 2 };
  const quote = computeQuote(stats, settings);
  const make = (overrides: Partial<typeof DEFAULT_BUSINESS> = {}, client?: string): ReturnType<typeof buildQuoteDocument> =>
    buildQuoteDocument({
      business: { ...DEFAULT_BUSINESS, name: 'Taller', ...overrides },
      fileName: 'cubo.stl',
      stats,
      settings,
      quote,
      image: null,
      ...(client === undefined ? {} : { client }),
      date: new Date(2026, 9, 24),
    });

  it('por defecto no enseña costes internos, margen ni precio por kilo', () => {
    const doc = make();
    const labels = doc.breakdownRows.map(([label]) => label).join(' | ');
    expect(labels).not.toMatch(/Margen|Subtotal|Energía|^Material/);
    expect(doc.breakdownTitle).toBe('Resumen');
    expect(doc.pieceRows.find(([label]) => label === 'Material')?.[1]).toBe('PLA');
    expect(labels).toMatch(/Precio por copia/);
    expect(doc.totalRows.at(-1)?.[0]).toBe('Total con IVA');
  });

  it('con pdfShowCosts sale el desglose completo de antes', () => {
    const doc = make({ pdfShowCosts: true });
    const labels = doc.breakdownRows.map(([label]) => label).join(' | ');
    expect(labels).toMatch(/Margen \(30 %\)/);
    expect(labels).toMatch(/Subtotal/);
    expect(doc.breakdownTitle).toBe('Desglose');
    expect(doc.pieceRows.find(([label]) => label === 'Material')?.[1]).toMatch(/€\/kg/);
  });

  it('cliente y notas del negocio, limpios', () => {
    const doc = make({ notes: 'Entrega en 3 días\n\nPago por transferencia' }, '  Ana\u0007  López ');
    expect(doc.meta.at(-1)).toEqual(['Cliente', 'Ana López']);
    expect(doc.notes.slice(0, 2)).toEqual(['Entrega en 3 días', 'Pago por transferencia']);
    expect(make().meta.map(([label]) => label)).not.toContain('Cliente');
  });

  it('como mucho 6 líneas de notas propias (no pisan el pie del PDF)', () => {
    const doc = make({ notes: Array.from({ length: 20 }, (_, i) => `n${i}`).join('\n') });
    expect(doc.notes.filter((note) => /^n\d+$/.test(note))).toHaveLength(6);
  });
});
