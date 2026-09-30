# Contribuir a printquote

Gracias por querer ayudar. Esta guía es breve; las reglas completas del proyecto están en [`AGENTS.md`](AGENTS.md) y el estado y las decisiones, en [`MEMORY.md`](MEMORY.md). Léelos antes de empezar. La guía para personas usuarias es [`docs/USO.md`](docs/USO.md).

## Requisitos

- **Node 22.12 o superior** (el CI usa Node 22) y **npm**.
- Un navegador moderno con WebGL para probar el visor.

```bash
git clone https://github.com/BertMarti/printquote.git
cd printquote
npm ci
npm run dev        # http://localhost:5173/printquote/
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente. |
| `npm run lint` | ESLint sobre todo el proyecto. |
| `npm run typecheck` | TypeScript estricto sobre `src/` y `tests/`. |
| `npm test` | Tests unitarios y de interfaz (Vitest). `npm run test:watch` los deja escuchando. |
| `npm run build` | Comprueba tipos y genera la web estática en `dist/`. |
| `npm run preview` | Sirve `dist/` en <http://localhost:4173/printquote/>. |
| `npm run sample` | Regenera la pieza de ejemplo `public/samples/soporte-movil.stl`. |

Antes de abrir un PR: `npm run lint && npm test && npm run build` en verde. El CI lo repite en Ubuntu y Windows.

## Ramas y pull requests

- `main` está protegida: **nunca se hace commit directo**. Crea una rama desde `main` (`feat/...`, `fix/...`, `docs/...`; el equipo de agentes usa `agent/<nombre>`) y abre un pull request.
- Rellena la plantilla del PR (qué cambia, cómo se ha verificado, checklist).
- Cambios pequeños y con sentido propio, un tema por PR.
- Actualiza `MEMORY.md` al terminar (estado, decisiones, siguiente paso y una línea en «Registro de sesiones»).
- No subas claves, tokens ni datos personales: el repositorio es público. No añadas dependencias sin justificarlas en «Decisiones» de `MEMORY.md`.

## Commits

[Commits convencionales](https://www.conventionalcommits.org/es/) en español: `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`, `perf:`. Ejemplo: `fix: importes redondeados a céntimos línea a línea`.

## Dónde está cada cosa

La interfaz y la documentación van en español; los nombres del código, en inglés.

| Qué | Dónde | Cómo se prueba |
|---|---|---|
| Lectura de STL (binario y ASCII) | `src/stl/parse.ts` | `tests/parse.test.ts`, `tests/parse-edge.test.ts` |
| Volumen, superficie, caja, aristas abiertas, avisos y «¿cabe en la cama?» | `src/stl/geometry.ts` | `tests/geometry.test.ts`, `tests/weld.test.ts` |
| Worker y respaldo en el hilo principal | `src/stl/stl.worker.ts`, `src/stl/analyzer.ts`, `src/stl/analyze.ts` | `tests/analyzer.test.ts` |
| Fórmulas del presupuesto (cáscara, relleno, peso, tiempo, energía, margen, redondeo) | `src/quote/model.ts` | `tests/quote.test.ts`, `tests/quote-edge.test.ts` |
| Materiales y densidades | `src/quote/materials.ts` | `tests/quote.test.ts` |
| Ajustes, valores por defecto y rangos (`LIMITS`) | `src/quote/settings.ts` | `tests/quote.test.ts` |
| Formato es-ES y lectura de números | `src/quote/format.ts` | `tests/format.test.ts` |
| Texto para copiar | `src/quote/text.ts` | `tests/format.test.ts` |
| Interfaz, campos, hoja de impresión | `index.html`, `src/ui/`, `src/styles.css` | `tests/ui.test.ts` (carga el `index.html` real con happy-dom), `tests/meta.test.ts` |
| Visor three.js | `src/viewer/` | a mano en el navegador (`npm run dev`) |

### Cómo testear una fórmula

Las fórmulas de `src/quote/` y `src/stl/geometry.ts` son **funciones puras**: mismos datos, mismo resultado. Para cambiar una:

1. Escribe primero el caso en `tests/quote.test.ts` con un cálculo hecho a mano. Los STL de prueba se construyen en memoria con los ayudantes de `tests/helpers/mesh.ts` (por ejemplo, `cubeTriangles`); no se suben archivos STL al repositorio.
2. Un cubo de 20 mm (V = 8 000 mm³, A = 2 400 mm²) con los valores por defecto es la referencia del README: 3 328 mm³ impresos, 4,13 g, 12 min y 0,10 €.
3. Si cambia una fórmula o un valor por defecto, actualiza también el README y `docs/USO.md`: deben coincidir con el código.

## Añadir un material

1. **`src/quote/materials.ts`**: añade el identificador al tipo `MaterialId`, la entrada en `MATERIALS` (nombre, densidad en g/cm³ y precio por defecto en €/kg) y el identificador en `MATERIAL_IDS`.
2. **`src/quote/settings.ts`**: añade el precio por defecto a `DEFAULT_SETTINGS.pricePerKg` (la lista es explícita).
3. **`index.html`**: añade su botón `<label class="segment">…` dentro del `fieldset` de material, con la densidad. La interfaz lee los materiales desde ahí.
4. **Tests**: revisa `tests/quote.test.ts` y `tests/quote-edge.test.ts` (asumen cuatro materiales en algunos casos, p. ej. `MATERIAL_IDS[i % 4]` y la comparación de `pricePerKg`) y añade un caso con el peso de un relleno del 100 % con la nueva densidad.
5. **Documentación**: actualiza las tablas de materiales del README y de `docs/USO.md`.

## Reglas de diseño

El diseño es una «hoja técnica suiza» (detalle en [`AGENTS.md`](AGENTS.md)). Lo que más se rompe sin querer:

- **El acento naranja `#ff5a1f` nunca se usa como color de texto sobre fondo claro**: no llega a 3:1 de contraste. Solo va en rellenos (con texto de tinta encima) y como cifra sobre fondo tinta.
- **Las cifras van en monoespaciada** (clase `.num`, `ui-monospace`, `tabular-nums`) y alineadas.
- Un único acento, sin sombras ni degradados, esquinas rectas, retícula fina.
- Mantén el modo oscuro (`prefers-color-scheme`) y el contraste AA en ambos modos.
- Los tiempos se rotulan siempre como **estimación**.
- Accesibilidad: todo control con etiqueta, uso completo con teclado, foco visible y regiones vivas sin repeticiones. El foco usa contorno de tinta.
- El texto de la interfaz y de los mensajes de error, en español; números con formato es-ES (coma decimal).

## Licencia

Al contribuir aceptas que tu aportación se publique bajo la licencia [MIT](LICENSE) del proyecto.
