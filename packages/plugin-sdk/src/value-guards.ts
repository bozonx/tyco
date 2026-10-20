/** Whether a value is an object with named fields rather than an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
