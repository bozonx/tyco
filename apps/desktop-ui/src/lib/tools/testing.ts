import {
  type BuiltinToolDependencies,
  createBuiltinTools,
} from './builtin-tools'
import { createToolRegistry } from './tool-registry'
import type { ToolDefinition } from './tool-types'

/** A registry of `script` and `webhook` and the given tools, for tests */
export function testTools(
  deps: BuiltinToolDependencies = {},
  extra: readonly ToolDefinition[] = []
) {
  return createToolRegistry([...createBuiltinTools(deps), ...extra])
}
