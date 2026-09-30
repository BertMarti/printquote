import { getLocale, t } from '../i18n';
import { parseDecimal } from '../quote/format';

export interface NumberFieldOptions {
  readonly input: HTMLInputElement;
  readonly error: HTMLElement | null;
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
  /** Máximo de decimales al mostrar el valor. */
  readonly decimals: number;
  /** Paso de las flechas ↑/↓ (Mayús: ×10). */
  readonly step: number;
  readonly onValue: (value: number) => void;
}

const inputFormats = new Map<string, Intl.NumberFormat>();

/** Valor para un campo editable: separador decimal del idioma, sin separador de miles, sin ceros sobrantes. */
export function formatInputValue(value: number, decimals: number): string {
  const locale = getLocale();
  const key = `${locale}:${decimals}`;
  let format = inputFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals, useGrouping: false });
    inputFormats.set(key, format);
  }
  return format.format(value);
}

/**
 * Campo numérico de texto que acepta coma o punto decimal, valida en vivo,
 * muestra el error junto al campo y admite ↑/↓ para ajustar el valor.
 */
export class NumberField {
  private value = 0;

  constructor(private readonly options: NumberFieldOptions) {
    const { input } = options;
    input.addEventListener('input', () => this.onInput());
    input.addEventListener('change', () => this.onCommit());
    input.addEventListener('blur', () => this.onCommit());
    input.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  /** Pone un valor desde fuera (sin disparar `onValue`). */
  set(value: number): void {
    this.value = value;
    this.options.input.value = formatInputValue(value, this.options.decimals);
    this.setError(null);
  }

  private parse(): number {
    const value = parseDecimal(this.options.input.value);
    return this.options.integer && Number.isFinite(value) && !Number.isInteger(value) ? Number.NaN : value;
  }

  private inRange(value: number): boolean {
    return Number.isFinite(value) && value >= this.options.min && value <= this.options.max;
  }

  private rangeMessage(): string {
    const { min, max, integer, decimals } = this.options;
    const kind = t(integer ? 'field.kind.integer' : 'field.kind.number');
    return t('field.range', { kind, min: formatInputValue(min, decimals), max: formatInputValue(max, decimals) });
  }

  private onInput(): void {
    const value = this.parse();
    if (this.inRange(value)) {
      this.setError(null);
      this.commit(value);
    } else {
      this.setError(this.rangeMessage());
    }
  }

  /** Al salir del campo: se limita al rango o, si no es un número, se vuelve al último valor válido. */
  private onCommit(): void {
    const value = this.parse();
    if (Number.isFinite(value)) {
      const clamped = Math.min(this.options.max, Math.max(this.options.min, value));
      this.commit(clamped);
    }
    this.set(this.value);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const current = this.inRange(this.parse()) ? this.parse() : this.value;
    const step = this.options.step * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    // Redondeo para evitar arrastrar errores de coma flotante (0,1 + 0,2…).
    const factor = 10 ** this.options.decimals;
    const next = Math.round((current + step) * factor) / factor;
    const clamped = Math.min(this.options.max, Math.max(this.options.min, next));
    this.commit(clamped);
    this.set(clamped);
  }

  private commit(value: number): void {
    if (value === this.value) return;
    this.value = value;
    this.options.onValue(value);
  }

  private setError(message: string | null): void {
    const { input, error } = this.options;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      if (error) {
        // El párrafo de error es una región viva siempre presente (vacía = invisible):
        // así los lectores de pantalla anuncian el mensaje en cuanto aparece.
        if (error.textContent !== message) error.textContent = message;
        error.dataset.owner = input.id;
      }
    } else {
      input.removeAttribute('aria-invalid');
      if (error && error.dataset.owner === input.id) {
        error.textContent = '';
        delete error.dataset.owner;
      }
    }
  }
}
