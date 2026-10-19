import {
  type MessageArguments,
  type MessageID,
  presentation,
} from './catalog.generated';

/** English is the sole shipped product language. Unsupported preferences fall back
 * to it without changing any route, OAuth callback, share URL or protocol value. */
export const PRODUCT_LOCALE = 'en';
export function resolveMessageLocale(
  _preferred?: string | readonly string[],
): 'en' {
  return PRODUCT_LOCALE;
}
export function formattingLocale(preferred?: string): string {
  if (!preferred) return PRODUCT_LOCALE;
  try {
    return Intl.getCanonicalLocales(preferred)[0] ?? PRODUCT_LOCALE;
  } catch {
    return PRODUCT_LOCALE;
  }
}

type Message = {
  source: string;
  arguments: Record<string, 'string' | 'number'>;
  plural?: { argument: string; one: string; other: string };
};
type Args<ID extends MessageID> = keyof MessageArguments[ID] extends never
  ? [arguments?: undefined, locale?: string]
  : [arguments: MessageArguments[ID], locale?: string];
/** Typed English dictionary adapter. Complete plural forms are selected with Intl;
 * this deliberately does not parse ICU or implement a universal runtime. */
export function message<ID extends MessageID>(
  id: ID,
  ...[args, locale]: Args<ID>
): string {
  const definition: Message = presentation.messages[id];
  const values = (args ?? {}) as Record<string, string | number>;
  const names = Object.keys(definition.arguments);
  if (
    names.length !== Object.keys(values).length ||
    names.some((name) => typeof values[name] !== definition.arguments[name])
  ) {
    throw new Error(`Message arguments do not match ${id}`);
  }
  let text = definition.source;
  if (definition.plural) {
    const count = values[definition.plural.argument];
    if (typeof count !== 'number' || !Number.isFinite(count))
      throw new Error(`Invalid plural count: ${id}`);
    const form = new Intl.PluralRules(resolveMessageLocale(locale)).select(
      count,
    );
    text = form === 'one' ? definition.plural.one : definition.plural.other;
  }
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    return typeof value === 'number'
      ? new Intl.NumberFormat(formattingLocale(locale)).format(value)
      : String(value);
  });
}
