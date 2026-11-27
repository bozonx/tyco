/** Includes a saved custom retention period without changing the defaults. */
export function historyRetentionChoices(
  defaultDays: readonly number[],
  saved: unknown
): number[] {
  const days = Number(saved)
  const choices = [...defaultDays]
  if (Number.isInteger(days) && days > 0 && !choices.includes(days)) {
    choices.push(days)
    choices.sort((a, b) => a - b)
  }
  return choices
}

/** Select options for retention periods; 0 days keeps the history forever */
export function historyRetentionOptions(
  choices: readonly number[],
  locale: string,
  foreverLabel: string
): { id: number; name: string }[] {
  const format = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
  })
  return choices.map((days) => ({
    id: days,
    name: days === 0 ? foreverLabel : format.format(days),
  }))
}
