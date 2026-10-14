/** The share of the budget from which the user is warned */
const CONTEXT_BUDGET_HIGH_RATIO = 0.7

type ContextBudgetLevel = 'ok' | 'high' | 'over'

export interface ContextBudget {
  /** Characters the next message takes with its attachments */
  used: number
  /** Characters the model takes in one request */
  budget: number
  /** Rounded share of the budget in percent */
  percent: number
  level: ContextBudgetLevel
}

/**
 * How much of the model the next message takes. Over the budget it cannot be
 * sent at all, see `sendMessage` in `chat-store`
 */
export function resolveContextBudget(
  texts: string[],
  budget: number,
  imageCharacters = 0
): ContextBudget {
  const used = texts.reduce((sum, text) => sum + text.length, imageCharacters)
  const ratio = budget > 0 ? used / budget : used > 0 ? Infinity : 0
  const level: ContextBudgetLevel =
    ratio > 1 ? 'over' : ratio >= CONTEXT_BUDGET_HIGH_RATIO ? 'high' : 'ok'
  return {
    used,
    budget,
    percent: Number.isFinite(ratio) ? Math.round(ratio * 100) : 100,
    level,
  }
}
