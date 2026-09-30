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
    for (const value of ['+', '=']) expect(keyZoomFactor(key(value)), value).toBeCloseTo(1 / KEY_ZOOM_STEP, 10);
    for (const value of ['-', '_']) expect(keyZoomFactor(key(value)), value).toBeCloseTo(KEY_ZOOM_STEP, 10);
    expect(keyZoomFactor(key('+'))).toBeLessThan(1);
    expect(keyZoomFactor(key('-'))).toBeGreaterThan(1);
  });

  it('acercar y alejar una vez vuelve al punto de partida', () => {
    expect((keyZoomFactor(key('+')) ?? 0) * (keyZoomFactor(key('-')) ?? 0)).toBeCloseTo(1, 10);
  });

  it('otras teclas no hacen zoom (las flechas siguen siendo de OrbitControls)', () => {
    for (const value of ['ArrowUp', 'a', '0', 'Enter', 'Tab', ' ']) expect(keyZoomFactor(key(value)), value).toBeNull();
  });

  it('con Ctrl, Cmd o Alt no se toca: es el zoom de la página o un atajo del sistema', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(keyZoomFactor(key('+', { [modifier]: true })), modifier).toBeNull();
      expect(keyZoomFactor(key('-', { [modifier]: true })), modifier).toBeNull();
    }
  });
});
