import type { MeshFormat } from '../stl/types';

/** Nombre del formato del archivo para mostrarlo: «STL binario», «OBJ»… */
export function formatLabel(format: MeshFormat): string {
  switch (format) {
    case 'binary':
      return 'STL binario';
    case 'ascii':
      return 'STL ASCII';
    case 'obj':
      return 'OBJ';
    case '3mf':
      return '3MF';
  }
}
