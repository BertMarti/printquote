import { describe, expect, it } from 'vitest';
import { ModelParseError } from '../src/stl/errors';
import { MAX_LINE_CHARS, parseObj } from '../src/stl/obj';
import { encode } from './helpers/mesh';

/** Tres vértices válidos; las líneas que se prueban van justo detrás (línea 4). */
const VERTICES = 'v 0 0 0\nv 1 0 0\nv 0 1 0\n';

/** Repite `unit` hasta superar `MAX_LINE_CHARS` (4 MB): el tope real, sin mock. */
function overLongLine(unit: string): string {
  return unit.repeat(Math.ceil(MAX_LINE_CHARS / unit.length) + 16);
}

function modelError(run: () => unknown): ModelParseError {
  try {
    run();
  } catch (error) {
    if (error instanceof ModelParseError) return error;
    throw error;
  }
  throw new Error('no se lanzó ningún ModelParseError');
}

describe('OBJ: líneas más largas de 4 MB', () => {
  it('una línea «f» de más de 4 MB se rechaza antes de trocearla, con su número de línea', () => {
    const face = `f 1 2 3 ${overLongLine('1 ')}`;
    expect(face.length).toBeGreaterThan(MAX_LINE_CHARS);

    const error = modelError(() => parseObj(encode(`${VERTICES}${face}\n`)));
    expect(error).toBeInstanceOf(ModelParseError);
    expect(error.code).toBe('err.obj.lineTooLong');
    expect(error.params.line).toBe(4);
    expect(error.params.mb).toBe(4);
    expect(error.message).toMatch(/Línea 4 del OBJ: ocupa más de 4 MB/);
  });

  it('una línea «v» de más de 4 MB también se rechaza (misma comprobación)', () => {
    const vertex = `v 0 0 0 ${overLongLine('1 ')}`;
    expect(vertex.length).toBeGreaterThan(MAX_LINE_CHARS);

    const error = modelError(() => parseObj(encode(`${VERTICES}${vertex}\nf 1 2 3\n`)));
    expect(error.code).toBe('err.obj.lineTooLong');
    expect(error.params.line).toBe(4);
  });

  it('una línea de comentario de 5 MB no es un error si el resto del OBJ es válido', () => {
    const comment = `# ${overLongLine('x')}`;
    expect(comment.length).toBeGreaterThan(MAX_LINE_CHARS);

    const mesh = parseObj(encode(`${VERTICES}${comment}\nf 1 2 3\n`));
    expect(mesh.format).toBe('obj');
    expect(mesh.triangleCount).toBe(1);
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('una línea larga que empieza por otra letra («o») tampoco se mira', () => {
    const group = `o ${overLongLine('x')}`;
    const mesh = parseObj(encode(`${VERTICES}${group}\nf 1 2 3\n`));
    expect(mesh.triangleCount).toBe(1);
  });
});
