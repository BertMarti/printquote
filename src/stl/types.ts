/** Formato de origen del archivo STL. */
export type StlFormat = 'binary' | 'ascii';

/**
 * Malla triangular sin indexar tal como viene en el STL.
 * `positions` guarda 9 números por triángulo (x, y, z de sus tres vértices), en mm.
 */
export interface Mesh {
  readonly positions: Float32Array;
  readonly triangleCount: number;
  readonly format: StlFormat;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly size: Vec3;
}

export interface MeshStats {
  readonly triangleCount: number;
  /** Volumen en mm³ (valor absoluto). */
  readonly volume: number;
  /** Volumen con signo antes del valor absoluto. Negativo o ≈ 0 indica malla abierta o invertida. */
  readonly signedVolume: number;
  /** Área de superficie en mm². */
  readonly surfaceArea: number;
  readonly bounds: BoundingBox;
  /** Aristas que no comparten exactamente dos triángulos (bordes abiertos o no variedad). */
  readonly openEdges: number;
}
