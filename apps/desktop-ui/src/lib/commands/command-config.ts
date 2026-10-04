import {
  ACTION_TEXT_PLACEHOLDER,
  type BuiltinToolId,
  COMMAND_CONFIRM_MODES,
  CUSTOM_ACTION_AFTER_RUN,
  type CommandConfig,
  type CommandConfirmMode,
  type CustomActionAfterRun,
  type MainActionConfig,
  type ScriptToolConfig,
  type WebhookToolConfig,
} from '@tyco/shared'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const stringOr = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const afterRunOf = (value: unknown): CustomActionAfterRun =>
  CUSTOM_ACTION_AFTER_RUN.includes(value as CustomActionAfterRun)
    ? (value as CustomActionAfterRun)
    : 'none'

const confirmOf = (value: unknown): CommandConfirmMode =>
  COMMAND_CONFIRM_MODES.includes(value as CommandConfirmMode)
    ? (value as CommandConfirmMode)
    : 'auto'

function headersOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

export function scriptToolConfig(command: CommandConfig): ScriptToolConfig {
  const config = command.toolConfig
  return {
    command: stringOr(config.command),
    workingDir: stringOr(config.workingDir),
    takesText: config.takesText !== false,
  }
}

export function webhookToolConfig(command: CommandConfig): WebhookToolConfig {
  const config = command.toolConfig
  return {
    url: stringOr(config.url),
    method: config.method === 'GET' ? 'GET' : 'POST',
    headers: headersOf(config.headers),
    payloadTemplate: stringOr(config.payloadTemplate),
    authSecret: Boolean(config.authSecret),
    takesText: config.takesText !== false,
  }
}

const normalizeToolConfig = (
  toolId: string,
  command: CommandConfig
): Record<string, unknown> => {
  if (toolId === 'script') return { ...scriptToolConfig(command) }
  if (toolId === 'webhook') return { ...webhookToolConfig(command) }
  // the settings of a tool this build does not know are kept as they are
  return command.toolConfig
}

/** A command read from the config, or `null` when it has no id or tool */
export function normalizeCommand(value: unknown): CommandConfig | null {
  if (!isRecord(value)) return null
  const id = stringOr(value.id).trim()
  const toolId = stringOr(value.toolId).trim()
  if (!id || !toolId) return null

  const availableIn = isRecord(value.availableIn) ? value.availableIn : {}
  const command: CommandConfig = {
    id,
    name: stringOr(value.name),
    phrases: Array.isArray(value.phrases)
      ? value.phrases.filter((item): item is string => typeof item === 'string')
      : [],
    toolId,
    toolConfig: isRecord(value.toolConfig) ? value.toolConfig : {},
    llmArgumentParsing: value.llmArgumentParsing === true,
    afterRun: afterRunOf(value.afterRun),
    logOutput: value.logOutput === true,
    confirm: confirmOf(value.confirm),
    availableIn: {
      launcher: availableIn.launcher === true,
      external: availableIn.external === true,
      chat: availableIn.chat === true,
    },
    enabled: value.enabled !== false,
  }
  if (typeof value.description === 'string' && value.description) {
    command.description = value.description
  }
  command.toolConfig = normalizeToolConfig(toolId, command)
  return command
}

/** The command library from the config; a repeated id keeps the first one */
export function normalizeCommands(value: unknown): CommandConfig[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const command = normalizeCommand(item)
    if (!command || seen.has(command.id)) return []
    seen.add(command.id)
    return [command]
  })
}

export function newCommandId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `command-${Date.now()}`
}

/** A new command of the library with the defaults for its tool */
export function createCommand(
  toolId: BuiltinToolId,
  id: string = newCommandId()
): CommandConfig {
  const toolConfig: ScriptToolConfig | WebhookToolConfig =
    toolId === 'script'
      ? { command: '', workingDir: '', takesText: true }
      : {
          url: '',
          method: 'POST',
          headers: {},
          payloadTemplate: '',
          authSecret: false,
          takesText: true,
        }
  return {
    id,
    name: '',
    phrases: [],
    toolId,
    toolConfig: { ...toolConfig },
    llmArgumentParsing: false,
    afterRun: 'none',
    logOutput: false,
    // a script runs with the rights of the user and cannot be undone
    confirm: toolId === 'script' ? 'always' : 'auto',
    availableIn: { launcher: true, external: true, chat: false },
    enabled: true,
  }
}

/** Whether the command is one this build can run */
export function isKnownTool(command: CommandConfig): boolean {
  return command.toolId === 'script' || command.toolId === 'webhook'
}

/** Whether the command gets the text it is invoked on */
export function commandTakesText(command: CommandConfig): boolean {
  return isKnownTool(command) && command.toolConfig.takesText !== false
}

/** Whether the command can be an item of the action menu */
export function isMenuCommand(command: CommandConfig): boolean {
  return command.enabled && commandTakesText(command)
}

export function commandIcon(command: CommandConfig): string {
  if (command.toolId === 'script') return 'mdi:console-line'
  if (command.toolId === 'webhook') return 'mdi:webhook'
  return 'mdi:puzzle-outline'
}

/** The name shown for the command, never empty */
export function commandLabel(command: CommandConfig): string {
  if (command.name.trim()) return command.name
  if (command.toolId === 'script') {
    return scriptToolConfig(command).command.trim() || 'Command'
  }
  if (command.toolId === 'webhook') return 'Webhook'
  return command.id
}

/**
 * What the command runs, shown before it does: the shell command of a script,
 * the method and URL of a webhook
 */
export function commandTarget(command: CommandConfig): string {
  if (command.toolId === 'script') return scriptToolConfig(command).command
  if (command.toolId === 'webhook') {
    const config = webhookToolConfig(command)
    return `${config.method ?? 'POST'} ${config.url}`
  }
  return ''
}

/**
 * A name as external calls compare it: case, `ё` and spaces do not matter. Keep
 * in sync with `normalize_name` in `services/external_commands.rs`
 */
export function normalizeCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/** Whether an external call may run the command */
export function isExternalCommand(command: CommandConfig): boolean {
  return command.enabled && command.availableIn.external && isKnownTool(command)
}

/**
 * The other commands an external call by the name of `command` could mean as
 * well: such a call is refused as ambiguous
 */
export function externalNameTwins(
  commands: readonly CommandConfig[],
  command: CommandConfig
): CommandConfig[] {
  const name = normalizeCommandName(command.name)
  if (!name || !isExternalCommand(command)) return []
  return commands.filter(
    (other) =>
      other.id !== command.id &&
      isExternalCommand(other) &&
      normalizeCommandName(other.name) === name
  )
}

export interface CommandIssue {
  /** The tool config field the issue is about */
  field: string
  messageKey: string
}

const hasPlaceholder = (value: string | undefined): boolean =>
  Boolean(value?.includes(ACTION_TEXT_PLACEHOLDER))

/** What keeps the command from running as the user expects */
export function validateCommand(command: CommandConfig): CommandIssue[] {
  const issues: CommandIssue[] = []
  if (command.toolId === 'script') {
    const config = scriptToolConfig(command)
    if (!config.command.trim()) {
      issues.push({ field: 'command', messageKey: 'commands.errorNoCommand' })
    }
    if (!config.takesText && hasPlaceholder(config.command)) {
      issues.push({
        field: 'command',
        messageKey: 'commands.errorTextPlaceholder',
      })
    }
  } else if (command.toolId === 'webhook') {
    const config = webhookToolConfig(command)
    if (!config.url.trim()) {
      issues.push({ field: 'url', messageKey: 'commands.errorNoUrl' })
    }
    if (!config.takesText) {
      if (hasPlaceholder(config.url)) {
        issues.push({
          field: 'url',
          messageKey: 'commands.errorTextPlaceholder',
        })
      }
      if (config.method === 'POST' && hasPlaceholder(config.payloadTemplate)) {
        issues.push({
          field: 'payloadTemplate',
          messageKey: 'commands.errorTextPlaceholder',
        })
      }
    }
  } else {
    issues.push({ field: 'toolId', messageKey: 'commands.errorUnknownTool' })
  }
  return issues
}

/** The menu without the items that refer to the command */
export function removeCommandReferences(
  slots: readonly (MainActionConfig | null)[],
  commandId: string
): (MainActionConfig | null)[] {
  return slots.map((slot) =>
    slot?.type === 'command' && slot.commandId === commandId ? null : slot
  )
}
