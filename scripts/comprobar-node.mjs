// Comprobación previa de `npm run dev` y `npm run build`: explica en español qué versión de Node hace falta
// en vez de dejar que Vite falle con un error críptico. Sin dependencias: solo `process.versions`.
const [major, minor] = process.versions.node.split('.').map(Number);
const at = (a, b) => major > a || (major === a && minor >= b);

if (!at(20, 19)) {
  console.error(
    `\n✖ printquote necesita Node 22.12 o superior y tienes Node ${process.versions.node}.\n` +
      '  Instálalo desde https://nodejs.org (versión LTS) o, con nvm, ejecuta en esta carpeta: nvm install && nvm use\n',
  );
  process.exit(1);
}
if (!at(22, 12)) {
  console.warn(
    `\n⚠ Tienes Node ${process.versions.node}. Funciona, pero el proyecto se prueba con Node 22.12 o superior.\n` +
      '  Si algo falla, actualiza Node (https://nodejs.org) o usa nvm: nvm install && nvm use\n',
  );
}
