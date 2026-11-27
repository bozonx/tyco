/** The message keys of the plural forms of one message, by CLDR category */
export interface PluralKeys {
  one: string
  few: string
  many: string
  other: string
}

/**
 * The key of the form of `keys` that `count` takes in `locale`; a category a
 * message has no form of, such as `zero` or `two`, takes the `other` form
 */
export function pluralKey(
  keys: PluralKeys,
  count: number,
  locale: string
): string {
  const category = new Intl.PluralRules(locale).select(count)
  return category in keys ? keys[category as keyof PluralKeys] : keys.other
}
