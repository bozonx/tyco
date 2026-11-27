import type { RegisteredOperation } from './operation-types'

const QUIET_CORE_OPERATIONS = new Set([
  'script',
  'webhook',
  'core.aiTask',
  'core.correct',
  'core.translate',
  'core.transformation',
  'core.styling',
])

export function canOperationRunQuietly(tool: RegisteredOperation): boolean {
  if (tool.owner.kind === 'plugin') return tool.canRunQuietly === true
  return tool.canRunQuietly !== false && QUIET_CORE_OPERATIONS.has(tool.id)
}
