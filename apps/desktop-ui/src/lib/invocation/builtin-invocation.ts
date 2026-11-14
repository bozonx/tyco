import { operationLabel } from '../operations/operation-label'
import type { OperationLookup } from '../operations/operation-types'
import type { Invocation } from './invocation-types'

/**
 * The invocation of a tool as it is, with no command of the library behind it:
 * a built-in action, or a step that has gathered the settings itself
 */
export function builtinInvocation(
  operationId: string,
  operations: OperationLookup,
  t: (key: string) => string,
  operationConfig: Record<string, unknown> = {}
): Invocation {
  const tool = operations.get(operationId)
  return {
    operationId,
    operationConfig,
    label: tool ? operationLabel(tool, t) : operationId,
  }
}
