import type { RegisteredOperation } from './operation-types'
export {
  operationInputSchema,
  schemaShape,
  operationInputKind,
  validateOperationInput,
  resolveOperationInput,
  type OperationInputRequest,
} from '@tyco/plugin-sdk'

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && !value.trim())

/**
 * The settings a call gets: those of the command over the plugin settings; a
 * field the command leaves empty falls back to the plugin
 */
export function operationCallConfig(
  tool: RegisteredOperation,
  operationConfig: Record<string, unknown>
): Record<string, unknown> {
  const config = { ...(tool.baseConfig?.() ?? {}) }
  for (const [selector, presets] of Object.entries(tool.configPresets ?? {})) {
    const selected = operationConfig[selector]
    if (
      (typeof selected === 'string' || typeof selected === 'number') &&
      Object.hasOwn(presets, selected)
    )
      Object.assign(config, presets[selected])
  }
  for (const [key, value] of Object.entries(operationConfig)) {
    if (!isEmpty(value) || !(key in config)) config[key] = value
  }
  return config
}
