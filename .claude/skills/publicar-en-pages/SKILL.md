---
name: publicar-en-pages
description: Úsala para verificar y publicar printquote en GitHub Pages mediante el workflow existente.
---

# Publicar en GitHub Pages

## Antes del pull request

1. Comprueba que `vite.config.ts` mantiene `base: '/printquote/'` para desarrollo, build y preview.
2. Ejecuta `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
3. Comprueba que `dist/index.html` contiene el `<meta http-equiv="Content-Security-Policy">` generado por `scripts/csp-plugin.ts`.
4. Sirve `dist/` bajo `/printquote/` y prueba la aplicación desde ese prefijo, incluida la carga de `#ejemplo`.
5. Abre un pull request contra `main`. Nunca hagas push a `main` ni publiques desde una rama sin revisar.

## Después de fusionar

- El workflow `.github/workflows/deploy.yml` se activa al hacer push a `main`; también admite `workflow_dispatch`.
- Comprueba que el job de build termina y que el job de despliegue usa los permisos de Pages e identidad definidos en el workflow.
- Verifica la publicación en <https://bertmarti.github.io/printquote/> y prueba que los assets se resuelven bajo `/printquote/`.
