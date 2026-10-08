import type {
  ToolDefinition as SdkToolDefinition,
  DefaultCommandsContext as SdkDefaultCommandsContext,
  DefaultCommand,
} from '@tyco/plugin-sdk'
import type { UserConfig } from '@tyco/shared'
export * from '@tyco/plugin-sdk'

export interface DefaultCommandsContext extends SdkDefaultCommandsContext {
  userConfig: UserConfig
}
export interface ToolDefinition extends Omit<
  SdkToolDefinition,
  'defaultCommands'
> {
  defaultCommands?(context: DefaultCommandsContext): DefaultCommand[]
}

/** Who provides a tool of the registry */
export type ToolOwner = { kind: 'core' } | { kind: 'plugin'; name: string }

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
