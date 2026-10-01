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
- `src/quote/` modelo de coste (material, relleno, tiempo, energía, margen).
- `src/viewer/` visor three.js.
- `src/ui/` panel y controles.
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
