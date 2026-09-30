import { t, type Key } from './index';

/**
 * Traduce el HTML estático. El `index.html` lleva el texto en español (así se ve bien antes de
 * que cargue el JS y sin JS) y estos atributos indican qué clave lo sustituye:
 * - `data-i18n="clave"`: el texto del elemento.
 * - `data-i18n-attr="atributo:clave;otro:clave"`: atributos (`aria-label`, `title`…).
 */
export function applyStaticTranslations(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset['i18n'] as Key | undefined;
    if (key) node.textContent = t(key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of (node.dataset['i18nAttr'] ?? '').split(';')) {
      const [attribute, key] = pair.split(':');
      if (attribute && key) node.setAttribute(attribute.trim(), t(key.trim() as Key));
    }
  }
}
