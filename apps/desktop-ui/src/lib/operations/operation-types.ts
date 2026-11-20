import type { CommandEnvironment } from '../variables/command-variables'
import type {
  OperationDefinition as SdkOperationDefinition,
  OperationCommandParameter as SdkOperationCommandParameter,
  JsonSchema,
  OperationCall,
  OperationResult,
} from '@tyco/plugin-sdk'
export * from '@tyco/plugin-sdk'

/** A call of a tool of the app: what the host knows beyond the plugin SDK */
export interface HostOperationCall extends OperationCall {
  /**
   * The AI commands that led to this call, outermost first; absent for a call
   * made by the user
   */
  callerCommandIds?: readonly string[]
}

export interface OperationDefinition extends SdkOperationDefinition {
  run(call: HostOperationCall): Promise<OperationResult>
  configPresets?: Record<string, Record<string, object>>
  inputSchemaFor?(config: Record<string, unknown>): JsonSchema
  getUnavailableReasonKey?(): string | undefined
  /** The tool writes its output to the action log when the command asks */
  canLogOutput?: boolean
  /**
   * A text field the settings editor offers a folder picker for: the setting
   * that grants a notes plugin its notes root
   */
  directoryFieldName?: string
  /**
   * The settings a command may leave to its caller: a voice phrase names the
   * value, an agent or an external caller gives it in the input
   */
  commandParameters?: readonly OperationCommandParameter[]
  /**
   * The i18n key of the voice phrases of a command without phrases of its own,
   * separated by `;`; `{name}` marks where a parameter is spoken, otherwise it
   * follows the phrase
   */
  voicePhrasesKey?: string
}

/** A setting of a command its caller gives, see `commandParameters` */
export interface OperationCommandParameter extends SdkOperationCommandParameter {
  /**
   * The i18n key of an object of the values, each with its spoken variants
   * separated by `;`; the keys of `en-US` are the values
   */
  voiceValuesKey?: string
  valueLabelKey?: (value: string) => string
}

/** Who provides a tool of the registry */
export type OperationOwner =
  { kind: 'core' } | { kind: 'plugin'; pluginId: string }

/** A tool of the registry under its full id */
export interface RegisteredOperation extends OperationDefinition {
  owner: OperationOwner
  /**
   * The settings a command falls back to for the fields it leaves empty: the
   * settings of the plugin
   */
  baseConfig?(): Record<string, unknown>
}

/** What the commands need from the registry */
export interface OperationLookup {
  get(operationId: string): RegisteredOperation | undefined
  /**
   * The platform and the variable values of this device; without it a command
   * is not checked against them
   */
  environment?: () => CommandEnvironment
}
