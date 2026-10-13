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
