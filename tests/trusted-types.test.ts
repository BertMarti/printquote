import { describe, expect, it } from 'vitest';
import { checkScriptUrl } from '../src/trusted-types';

const ORIGIN = 'https://bertmarti.github.io';
const BASE = `${ORIGIN}/printquote/#ejemplo`;
const check = (input: string): string => checkScriptUrl(input, BASE, ORIGIN, '/printquote/');

describe('checkScriptUrl (política de Trusted Types)', () => {
  it('admite el worker y el service worker de la propia app', () => {
    expect(check('/printquote/assets/stl.worker-abc.js')).toBe(`${ORIGIN}/printquote/assets/stl.worker-abc.js`);
    expect(check('/printquote/sw.js')).toBe(`${ORIGIN}/printquote/sw.js`);
    expect(check('assets/stl.worker-abc.js')).toBe(`${ORIGIN}/printquote/assets/stl.worker-abc.js`);
  });

  it('rechaza scripts de otro origen o de otra web del origen compartido', () => {
    expect(() => check('https://evil.example/x.js')).toThrow(TypeError);
    expect(() => check('//evil.example/printquote/x.js')).toThrow(TypeError);
    expect(() => check('/otra-web/sw.js')).toThrow(TypeError);
    expect(() => check('/printquote-falso/sw.js')).toThrow(TypeError);
    expect(() => check('/printquote/../otra-web/sw.js')).toThrow(TypeError);
  });

  it('rechaza esquemas que ejecutan código o traen datos', () => {
    expect(() => check('data:text/javascript,alert(1)')).toThrow(TypeError);
    expect(() => check('blob:https://bertmarti.github.io/123')).toThrow(TypeError);
    expect(() => check('javascript:alert(1)')).toThrow(TypeError);
  });
});
