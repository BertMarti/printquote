import { t } from '../i18n';
import type { MeshFormat } from '../stl/types';

/** Nombre del formato del archivo en el idioma activo: «STL binario», «OBJ»… */
export function formatLabel(format: MeshFormat): string {
  return t(`format.${format}`);
}
