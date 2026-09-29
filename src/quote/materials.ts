export type MaterialId = 'PLA' | 'PETG' | 'ABS' | 'TPU';

export interface Material {
  readonly id: MaterialId;
  readonly name: string;
  /** Densidad en g/cm³. */
  readonly density: number;
  /** Precio por defecto en €/kg. */
  readonly defaultPricePerKg: number;
}

export const MATERIALS: Readonly<Record<MaterialId, Material>> = {
  PLA: { id: 'PLA', name: 'PLA', density: 1.24, defaultPricePerKg: 20 },
  PETG: { id: 'PETG', name: 'PETG', density: 1.27, defaultPricePerKg: 24 },
  ABS: { id: 'ABS', name: 'ABS', density: 1.04, defaultPricePerKg: 22 },
  TPU: { id: 'TPU', name: 'TPU', density: 1.21, defaultPricePerKg: 35 },
};

export const MATERIAL_IDS: readonly MaterialId[] = ['PLA', 'PETG', 'ABS', 'TPU'];

export function isMaterialId(value: unknown): value is MaterialId {
  return typeof value === 'string' && (MATERIAL_IDS as readonly string[]).includes(value);
}
