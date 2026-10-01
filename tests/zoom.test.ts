import { describe, expect, it } from 'vitest';
import { KEY_ZOOM_STEP, keyZoomFactor } from '../src/viewer/zoom';

const key = (value: string, modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

describe('zoom con teclado', () => {
  it('+ y = acercan (distancia menor), también en el teclado numérico; - y _ alejan', () => {
    for (const value of ['+', '=']) expect(keyZoomFactor(key(value), true), value).toBeCloseTo(1 / KEY_ZOOM_STEP, 10);
    for (const value of ['-', '_']) expect(keyZoomFactor(key(value), true), value).toBeCloseTo(KEY_ZOOM_STEP, 10);
    expect(keyZoomFactor(key('+'), true)).toBeLessThan(1);
    expect(keyZoomFactor(key('-'), true)).toBeGreaterThan(1);
  });

  it('acercar y alejar una vez vuelve al punto de partida', () => {
    expect((keyZoomFactor(key('+'), true) ?? 0) * (keyZoomFactor(key('-'), true) ?? 0)).toBeCloseTo(1, 10);
  });

  it('otras teclas no hacen zoom (las flechas siguen siendo de OrbitControls)', () => {
    for (const value of ['ArrowUp', 'a', '0', 'Enter', 'Tab', ' ']) expect(keyZoomFactor(key(value), true), value).toBeNull();
  });

  it('con Ctrl, Cmd o Alt no se toca: es el zoom de la página o un atajo del sistema', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(keyZoomFactor(key('+', { [modifier]: true }), true), modifier).toBeNull();
      expect(keyZoomFactor(key('-', { [modifier]: true }), true), modifier).toBeNull();
    }
  });

  it('con el visor vacío (sin pieza) no hace nada, ni siquiera con una tecla de zoom', () => {
    for (const value of ['+', '=', '-', '_']) expect(keyZoomFactor(key(value), false), value).toBeNull();
  });
});
