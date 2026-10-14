/** The share of the budget from which the user is warned */
const CONTEXT_BUDGET_HIGH_RATIO = 0.7

type ContextBudgetLevel = 'ok' | 'high' | 'over'

export interface ContextBudget {
  /** Characters the next message takes with its attachments */
  usedCharacters: number
  /** Characters the model takes in one request */
  budgetCharacters: number
  /** Rounded share of the budget in percent */
  usagePercent: number
  level: ContextBudgetLevel
}

/**
 * How much of the model the next message takes. Over the budget it cannot be
 * sent at all, see `sendMessage` in `chat-model`
 */
export function resolveContextBudget(
  texts: string[],
  budgetCharacters: number,
  imageCharacters = 0
): ContextBudget {
  const usedCharacters = texts.reduce(
    (sum, text) => sum + text.length,
    imageCharacters
  )
  const ratio =
    budgetCharacters > 0
      ? usedCharacters / budgetCharacters
      : usedCharacters > 0
        ? Infinity
        : 0
  const level: ContextBudgetLevel =
    ratio > 1 ? 'over' : ratio >= CONTEXT_BUDGET_HIGH_RATIO ? 'high' : 'ok'
  return {
    usedCharacters,
    budgetCharacters,
    usagePercent: Number.isFinite(ratio) ? Math.round(ratio * 100) : 100,
    level,
  }
}
