import { toolLabel } from '../tools/tool-label'
import type { ToolLookup } from '../tools/tool-types'
import type { Invocation } from './invocation-types'

/**
 * The invocation of a tool as it is, with no command of the library behind it:
 * a built-in action, or a step that has gathered the settings itself
 */
export function builtinInvocation(
  toolId: string,
  tools: ToolLookup,
  t: (key: string) => string,
  toolConfig: Record<string, unknown> = {}
): Invocation {
  const tool = tools.get(toolId)
  return { toolId, toolConfig, label: tool ? toolLabel(tool, t) : toolId }
}
