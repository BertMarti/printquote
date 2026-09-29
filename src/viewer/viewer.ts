import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../stl/types';

export interface ViewerTheme {
  background: string;
  ink: string;
  line: string;
  accent: string;
}

/** Dirección desde la que mira la cámara al encuadrar (frente-derecha, algo elevada). */
const VIEW_DIRECTION = new Vector3(0.9, -1.35, 0.85).normalize();
const FOV = 35;

/**
 * Visor 3D de la pieza sobre la cama. Trabaja con Z hacia arriba, como los laminadores.
 * Solo renderiza cuando algo cambia (no hay bucle continuo) para no gastar batería.
 */
export class Viewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 20000);
  private readonly controls: OrbitControls;
  private readonly bedGroup = new Group();
  private readonly partGroup = new Group();
  private readonly partMaterial = new MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
  private readonly edgeMaterial = new LineBasicMaterial({ transparent: true, opacity: 0.35 });
  private readonly minorMaterial = new LineBasicMaterial();
  private readonly majorMaterial = new LineBasicMaterial();
  private readonly outlineMaterial = new LineBasicMaterial();
  private readonly resizeObserver: ResizeObserver;
  private bed: Vec3 = { x: 220, y: 220, z: 250 };
  private partSize: Vec3 | null = null;
  private frame = 0;

  constructor(private readonly container: HTMLElement, theme: ViewerTheme) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new HemisphereLight(0xffffff, 0x8a8580, 1.6));
    this.scene.add(new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(-1.2, -2, 3);
    this.scene.add(key);
    const rim = new DirectionalLight(0xffffff, 0.5);
    rim.position.set(2, 3, 1);
    this.scene.add(rim);

    this.scene.add(this.bedGroup, this.partGroup);
    this.setTheme(theme);
    this.buildBed();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.resetCamera();
  }

  setTheme(theme: ViewerTheme): void {
    this.scene.background = new Color(theme.background);
    this.partMaterial.color.set(theme.accent);
    this.edgeMaterial.color.set(theme.ink);
    this.minorMaterial.color.set(theme.line);
    this.majorMaterial.color.set(new Color(theme.line).lerp(new Color(theme.ink), 0.25));
    this.outlineMaterial.color.set(theme.ink);
    this.requestRender();
  }

  /** Cambia el tamaño de la cama (mm) y redibuja la rejilla. */
  setBed(bed: Vec3): void {
    if (bed.x === this.bed.x && bed.y === this.bed.y && bed.z === this.bed.z) return;
    this.bed = bed;
    this.buildBed();
    this.requestRender();
  }

  /**
   * Muestra una malla (9 números por triángulo, mm). Se centra en la cama y se
   * apoya sobre ella (Z mínima = 0) solo para verla; los cálculos usan el original.
   */
  setPart(positions: Float32Array): void {
    this.clearPart();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions.slice(), 3));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return;
    const center = box.getCenter(new Vector3());
    geometry.translate(-center.x, -center.y, -box.min.z);
    geometry.computeVertexNormals();

    const mesh = new Mesh(geometry, this.partMaterial);
    this.partGroup.add(mesh);

    // Aristas marcadas (ángulo > 30°) para leer bien la forma, como en un plano.
    if (positions.length / 9 <= 400_000) {
      this.partGroup.add(new LineSegments(new EdgesGeometry(geometry, 30), this.edgeMaterial));
    }

    const size = box.getSize(new Vector3());
    this.partSize = { x: size.x, y: size.y, z: size.z };
    this.resetCamera();
  }

  clearPart(): void {
    for (const child of [...this.partGroup.children]) {
      this.partGroup.remove(child);
      if (child instanceof Mesh || child instanceof LineSegments) child.geometry.dispose();
    }
    this.partSize = null;
    this.requestRender();
  }

  /** Encuadra la pieza (o la cama si no hay pieza) desde la vista por defecto. */
  resetCamera(): void {
    const target = new Vector3();
    let radius: number;
    if (this.partSize) {
      const s = this.partSize;
      target.set(0, 0, s.z / 2);
      radius = Math.hypot(s.x, s.y, s.z) / 2;
    } else {
      radius = Math.hypot(this.bed.x, this.bed.y) / 2;
    }
    radius = Math.max(radius, 1);

    const vFov = (FOV * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.08;

    this.camera.near = Math.max(0.1, distance / 1000);
    this.camera.far = distance * 50;
    this.camera.position.copy(target).addScaledVector(VIEW_DIRECTION, distance);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.minDistance = radius * 0.2;
    this.controls.maxDistance = distance * 8;
    this.controls.update();
    this.requestRender();
  }

  /** Imagen PNG de la vista actual (para la hoja impresa). */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearPart();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      // Con amortiguación, update() devuelve true mientras la cámara siga moviéndose.
      const moving = this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (moving) this.requestRender();
    });
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Rejilla de la cama: línea fina cada 10 mm, marcada cada 50 mm y contorno. */
  private buildBed(): void {
    for (const child of [...this.bedGroup.children]) {
      this.bedGroup.remove(child);
      if (child instanceof LineSegments) child.geometry.dispose();
    }
    const { x: w, y: d } = this.bed;
    const x0 = -w / 2, y0 = -d / 2;
    const minor: number[] = [];
    const major: number[] = [];

    for (let x = 10; x < w; x += 10) {
      (x % 50 === 0 ? major : minor).push(x0 + x, y0, 0, x0 + x, y0 + d, 0);
    }
    for (let y = 10; y < d; y += 10) {
      (y % 50 === 0 ? major : minor).push(x0, y0 + y, 0, x0 + w, y0 + y, 0);
    }
    const outline = [
      x0, y0, 0, x0 + w, y0, 0,
      x0 + w, y0, 0, x0 + w, y0 + d, 0,
      x0 + w, y0 + d, 0, x0, y0 + d, 0,
      x0, y0 + d, 0, x0, y0, 0,
    ];

    const lines = (points: number[], material: LineBasicMaterial): LineSegments => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
      return new LineSegments(geometry, material);
    };
    // Un poco por debajo de Z = 0 para que la rejilla no «pelee» con la base de la pieza.
    this.bedGroup.position.z = -0.05;
    this.bedGroup.add(lines(minor, this.minorMaterial), lines(major, this.majorMaterial), lines(outline, this.outlineMaterial));
  }
}

/** ¿Puede este navegador crear un contexto WebGL? */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
