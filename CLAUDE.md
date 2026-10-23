@AGENTS.md
@MEMORY.md

# Claude Code en printquote
- Las reglas, comandos y contratos están en `AGENTS.md`; el estado y las decisiones, en `MEMORY.md`; la hoja de ruta, en `PLAN.md`.
- Subagentes del proyecto en `.claude/agents/`: `revisor-seguridad` (solo lectura, antes de abrir un PR que toque `src/stl/`, `index.html` o la CSP) y `probador-ui` (build servido en `/printquote/` y capturas en escritorio y móvil).
- Skills en `.claude/skills/`: `publicar-en-pages` y `anadir-formato-o-limite`.
- WebGL en Chromium sin cabeza necesita `--enable-unsafe-swiftshader` y es lento en la Raspberry Pi: no lances builds ni navegadores en paralelo.
- Antes de dar algo por terminado: `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, y actualiza `MEMORY.md` y `CHANGELOG.md`.
