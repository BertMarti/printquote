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

## Equipo de agentes y ramas
Los tres proyectos se desarrollan en paralelo con un equipo de agentes. **Cada agente trabaja solo en su rama** y todo entra en `main` mediante pull request.

| Agente | Herramienta | Rama | Cometido |
|---|---|---|---|
| lead | Claude Code (sesión principal) | `main` (solo merges) | Plan, revisión de PRs, integración, despliegue y documentación final |
| builder | Claude Code (subagente) | `agent/builder` | Implementa el MVP, los tests básicos, el CI y el despliegue |
| qa | Claude Code (subagente) | `agent/qa` | Revisa el código, añade tests de casos límite, corrige fallos y accesibilidad |
| docs | Claude Code (subagente, Sonnet); OpenCode cuando se permita su ejecución autónoma | `agent/docs` | Guía de uso para personas usuarias en `docs/USO.md` |

## Reglas para todos los agentes
1. **Lee `MEMORY.md` antes de empezar** y **actualízalo siempre al terminar** (estado, decisiones, siguiente paso y una línea en «Registro de sesiones» con fecha, agente y rama). Una sesión sin `MEMORY.md` actualizado no está terminada.
2. Nunca hagas commit directo a `main`. Trabaja en tu rama y abre un pull request.
3. Commits convencionales en español: `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`. Cambios pequeños y con sentido propio.
4. No subas claves, tokens, `.env` ni datos personales. El repositorio es público.
5. No añadas dependencias sin justificarlo en «Decisiones» de `MEMORY.md`.
6. Si algo es ambiguo, elige la opción más simple, anótala en `MEMORY.md` y sigue.
7. La interfaz y la documentación, en español. El código (nombres), en inglés.

## Terminado significa
- Lint y tests en verde en local y en el CI.
- La aplicación funciona desplegada en GitHub Pages.
- README al día y `MEMORY.md` actualizado.
