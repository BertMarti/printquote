// Comprobación previa de `npm run dev` y `npm run build`: explica en español qué versión de Node hace falta
// en vez de dejar que Vite falle con un error críptico. Sin dependencias: solo `process.versions`.
const [major, minor] = process.versions.node.split('.').map(Number);
const at = (a, b) => major > a || (major === a && minor >= b);

if (!at(20, 19)) {
  console.error(
    `\n✖ printquote necesita Node 20.19 o superior (tienes Node ${process.versions.node}); se recomienda 22.12, que es con el que se prueba.\n` +
      '  Instálalo desde https://nodejs.org (versión LTS) o, con nvm, ejecuta en esta carpeta: nvm install && nvm use\n',
  );
  process.exit(1);
}
if (!at(22, 12)) {
  console.warn(
    `\n⚠ Tienes Node ${process.versions.node}: funciona (el mínimo es 20.19), pero se recomienda 22.12, que es con el que se prueba.\n` +
      '  Si algo falla, actualiza Node (https://nodejs.org) o usa nvm: nvm install && nvm use\n',
  );
}
