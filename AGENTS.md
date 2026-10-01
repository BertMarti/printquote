# AGENTS.md · printquote

## Qué es
Web que calcula el presupuesto de una pieza de impresión 3D: arrastras un STL, lo ves en 3D y obtienes peso, tiempo estimado y precio. Todo ocurre en el navegador; el archivo nunca se sube a ningún servidor.

## Tecnología (propia de este proyecto)
- **TypeScript** estricto + **Vite** (build estático).
- **three.js** para el visor 3D (con `OrbitControls`).
- **Vitest** para tests; **ESLint** para lint.
- Sin frameworks de UI: DOM y CSS propios.
- Despliegue: **GitHub Pages** con GitHub Actions (`base: '/printquote/'`).

## Comandos
- Instalar: `npm ci`
- Desarrollo: `npm run dev`
- Lint: `npm run lint`
- Tests: `npm test`
- Build: `npm run build` (salida en `dist/`)

## Estructura
- `src/stl/` parser STL (binario y ASCII) y geometría (volumen, área, caja).
- `src/quote/` modelo de coste (material, relleno, tiempo, energía, margen) y lote de piezas (`batch.ts`: suma líneas de `computeQuote`; no tiene fórmula propia).
- `src/pdf/` presupuesto en PDF: contenido puro en `document.ts` (`buildQuoteDocument`, `buildBatchDocument`) y dibujo con pdf-lib en `render.ts`; un lote lleva `batch` (tabla de piezas a todo el ancho) y el dibujo pasa de página y numera («Página n de N»).
- `src/viewer/` visor three.js.
- `src/ui/` panel y controles.
- `src/ui/batch.ts` bloque «06 Lote» (instantáneas por pieza, persistidas; recibe un `BatchHost`, no importa `app.ts`). El bloque 07 es «Datos del negocio» y el 08, «Presupuestos».
- `src/ui/demo.ts` modo demo: guion `DEMO_STEPS` en datos y su control; no importa `app.ts`, recibe un `DemoHost` (ver «Modo demo»).
- `public/samples/` pieza de ejemplo original.
- `tests/` pruebas unitarias.

## Diseño: «hoja técnica suiza»
Minimalista, claro y preciso, como una ficha técnica.
- Fondo `#f6f5f2`, tinta `#111111`, líneas `#d9d6cf`, **un único acento naranja filamento `#ff5a1f`**.
- Tipografía del sistema; cifras en monoespaciada (`ui-monospace`) y alineadas.
- Retícula visible y fina; nada de sombras ni degradados; esquinas rectas.
- Visor grande a la izquierda, panel de especificaciones estrecho a la derecha; en móvil, uno debajo del otro.
- Modo oscuro con `prefers-color-scheme`.
- Los tiempos se rotulan siempre como **estimación**.
- Jerarquía de botones: en la cabecera **un único primario** (naranja, `button--primary`); el secundario lleva contorno (`button`) y el terciario va sin caja y subrayado (`button--ghost`).
- Dianas de **44 px** con puntero táctil o ≤ 900 px (`@media (pointer: coarse), (max-width: 900px)`); en escritorio con ratón se mantiene la densidad de la ficha. Sin desbordes de 320 a 1440 px.
- Los rótulos sobre el visor (medidas, leyenda, ayuda) llevan una pastilla del color del visor para leerse sobre la rejilla. La banda superior del visor (`.stage-top`) es un contenedor en flujo: ficha de la pieza y, debajo, el aviso.

## Modo demo («Ver demo»)
Recorrido guiado de ~13 s (`DEMO_END_MS`) que dirige `src/ui/demo.ts`. El guion son cuatro pasos en datos (`DEMO_STEPS`: carga el ejemplo con los ajustes por defecto → PETG → relleno 40 % → `'restore'` devuelve los ajustes de la persona); cada paso resalta el bloque que cambia (`.is-demo-focus`) y pone un subtítulo en `#demo-bar`.
- **Botón** `#demo-button` con `aria-pressed` (la etiqueta no cambia). Se para con un segundo clic, **Esc** o cualquier `pointerdown`/`keydown`/`wheel` fuera de los elementos con `data-demo-ui` (el botón y la barra), un archivo arrastrado o soltado (`dragenter`/`drop`, estén donde estén), un cambio de enlace (`hashchange`) y que la pestaña pase a segundo plano. Un arrastre desde el sistema no genera ningún gesto de los primeros, por eso se escucha aparte.
- **`prefers-reduced-motion`**: no corre sola ni gira la cámara; pasos manuales con «Siguiente» (el último, «Terminar») y el subtítulo es texto legible (sin `aria-hidden`).
- **Nunca persiste**: aplica ajustes con `applySettings(…, false)`; no toca `localStorage` ni el historial ni el hash. Al terminar o pararse **devuelve los ajustes de la persona** (y su pieza, si había una): `update()` guarda *todos* los ajustes en la siguiente edición y no deben colarse los de la demo.
- **Accesibilidad**: durante la demo el total y los avisos pasan a `aria-live="off"` y `announce()` se silencia; **un único anuncio al final**. Si se detiene mientras carga, el estado se devuelve cuando acaba la carga.
- **Contrato con la aplicación** (`DemoHost` en `demo.ts`; la implementa `app.ts`): `begin()`, `apply(patch | 'restore')`, `spin(on)` (`Viewer.setAutoRotate`), `end()` y `announce()`. `startApp(demoScale)` acepta una escala de tiempo solo para los tests de integración.
- Texto en `demo.*` (es/en). Funciona sin conexión: la pieza de ejemplo está en el precaché de la PWA.

## Lote («06 Lote»)
Presupuesto de pedidos con varias piezas. Contrato:
- **Sin fórmula propia**: cada línea es `computeQuote(stats, settings)`; `src/quote/batch.ts` solo suma líneas ya redondeadas a céntimos (`computeBatch`, como una factura) y el IVA se aplica **una vez** sobre la suma (`computeTax`).
- **Instantánea**: la línea (`BatchPart`) conserva los ajustes con que se añadió; no se edita (quitar y volver a añadir). Máximo `BATCH_MAX` = 50.
- **Persistencia**: el lote se guarda en `localStorage` (`printquote:lote:v1`, `{ v: 1, parts: HistoryPart[] }`; `loadBatch`/`saveBatch` en `ui/storage.ts`). Cada línea se guarda como `HistoryPart` (con `surfaceMm2`, sin geometría) y al leer se valida con las mismas funciones que el historial (`normalizeBatchParts`) y se recalcula con `computeQuote` (`batchFromParts`). Una pieza rota o sin área descarta el lote entero; si no cabe, falla en silencio.
- **Botones explícitos**: «Copiar presupuesto», «Imprimir», «Descargar PDF» y «Guardar este presupuesto» son de la pieza cargada; el lote tiene «Copiar lote», «PDF del lote» (sin vista 3D, con paginación) y «Guardar lote» (historial). Imprimir no incluye el lote. No hay un «modo» oculto.
- **Historial**: `HistoryEntry.parts?` (retrocompatible); un lote guardado no se puede abrir (no guarda la geometría) y el CSV lleva una fila por pieza.
- El enlace para compartir **nunca** lleva el lote.
- `src/ui/batch.ts` recibe un `BatchHost` (`current`, `announce`, `changed`) y no importa `app.ts`; la lista reutiliza las clases `.history-*` y `.rows`. Tras quitar, el foco pasa al siguiente «Quitar» o a «Añadir esta pieza».

## Equipo de agentes y ramas
Los tres proyectos se desarrollan en paralelo con un equipo de agentes. El trabajo está **guiado por issues de un hito** (p. ej. v0.2.0) y **todo entra en `main` mediante pull request**, que fusiona Alberto.

| Agente | Herramienta | Etiqueta de issue | Cometido |
|---|---|---|---|
| lead | Claude Code (sesión principal) | (crea el hito y las issues) | Plan, revisión de PRs, integración, despliegue y documentación final |
| builder | Claude Code (Sonnet) | `agent:builder` | Implementa las funciones, con sus tests |
| qa | Claude Code (Sonnet) | `agent:qa` | Revisa el código, añade tests de casos límite, corrige fallos y accesibilidad |
| docs | Claude Code (Sonnet); OpenCode cuando se permita su ejecución autónoma | `agent:docs` | Guía de uso (`docs/USO.md`) y documentación para personas usuarias y contribuidoras |

Flujo de trabajo:
1. Cada agente lee las issues de su hito con su etiqueta (`gh issue list --milestone <hito> --label agent:<rol>`); los criterios de aceptación de la issue son su contrato.
2. **Una rama y un PR por issue**, con el nombre `agent/<rol>/<n>-<slug>` (p. ej. `agent/builder/5-perfiles`). Si varias issues del mismo agente se solapan, cada rama parte de la anterior para evitar conflictos. Git no permite crear `agent/<rol>/…` mientras exista en el remoto una rama llamada `agent/<rol>` (caso de la antigua `agent/builder` del MVP): en ese caso se usa `agent/<rol>-<n>-<slug>` hasta que se borre la rama vieja.
3. **Los PR van siempre contra `main`** y llevan `Closes #<n>` en la descripción, qué cambia, cómo se verificó y, si depende de otro PR, «Se fusiona después de #<PR>».
4. Nadie hace commit ni push a `main`, y **nadie fusiona PRs salvo Alberto**.

## Reglas para todos los agentes
1. **Lee `MEMORY.md` antes de empezar** y **actualízalo siempre al terminar** (estado, decisiones, siguiente paso y una línea en «Registro de sesiones» con fecha, agente y rama). Una sesión sin `MEMORY.md` actualizado no está terminada.
2. Nunca hagas commit directo a `main`. Trabaja en tu rama (`agent/<rol>/<n>-<slug>`) y abre un pull request contra `main`.
3. Commits convencionales en español: `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`. Cambios pequeños y con sentido propio. El mensaje termina con una línea en blanco y las líneas `Agente: <rol> (<herramienta>)` y `Co-Authored-By: …`.
4. No subas claves, tokens, `.env` ni datos personales. El repositorio es público.
5. No añadas dependencias sin justificarlo en «Decisiones» de `MEMORY.md`.
6. Si algo es ambiguo, elige la opción más simple, anótala en `MEMORY.md` y sigue.
7. La interfaz está en español e inglés (diccionarios en `src/i18n/`; ningún texto visible en el código sin pasar por `t()`) y la documentación, en español. El código (nombres), en inglés.

## Terminado significa
- Lint y tests en verde en local y en el CI.
- La aplicación funciona desplegada en GitHub Pages.
- README al día y `MEMORY.md` actualizado.
