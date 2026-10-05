import type { RegisteredTool } from './tool-types'

/** The name of a tool shown to the user */
export function toolLabel(
  tool: Pick<RegisteredTool, 'id' | 'label' | 'labelKey'>,
  t: (key: string) => string
): string {
  if (tool.labelKey) return t(tool.labelKey)
  return tool.label || tool.id
}
