import type { RegisteredOperation } from './operation-types'

/** The name of a tool shown to the user */
export function operationLabel(
  tool: Pick<RegisteredOperation, 'id' | 'label' | 'labelKey'>,
  t: (key: string) => string
): string {
  if (tool.labelKey) return t(tool.labelKey)
  return tool.label || tool.id
}
