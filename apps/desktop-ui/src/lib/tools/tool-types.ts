import type {
  ToolDefinition as SdkToolDefinition,
  JsonSchema,
} from '@tyco/plugin-sdk'
export * from '@tyco/plugin-sdk'

export interface ToolDefinition extends SdkToolDefinition {
  configPresets?: Record<string, Record<string, object>>
  inputSchemaFor?(config: Record<string, unknown>): JsonSchema
  getUnavailableReasonKey?(): string | undefined
  /** The tool writes its output to the action log when the command asks */
  logsOutput?: boolean
}

/** Who provides a tool of the registry */
export type ToolOwner = { kind: 'core' } | { kind: 'plugin'; pluginId: string }

/** A tool of the registry under its full id */
export interface RegisteredTool extends ToolDefinition {
  owner: ToolOwner
  /**
   * The settings a command falls back to for the fields it leaves empty: the
   * settings of the plugin
   */
  baseConfig?(): Record<string, unknown>
}

/** What the commands need from the registry */
export interface ToolLookup {
  get(toolId: string): RegisteredTool | undefined
}
