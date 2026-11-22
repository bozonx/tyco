import type {
  CommandConfig,
  ProfileToolSettings,
  ToolCatalogSettings,
  ToolPolicy,
  ToolRef,
  ToolRisk,
  ToolSourceKind,
  ToolCallContext,
  ToolState,
} from '@tyco/shared'

/**
 * Tool sources, risks and the permissions to them: which tools a profile, the
 * "Ask AI" chat or an AI command gets, and how freely they run. Rust mirrors
 * the keys and the defaults in `services/ai_tools/permissions.rs`. See
 * `dev_docs/architecture.md`, "Tool sources and permissions"
 */

/** Profile tool settings as they may be read, from a readonly profile too */
export interface ProfileToolSettingsView {
  readonly sources: Readonly<Record<string, { readonly isEnabled: boolean }>>
  readonly tools: Readonly<Record<string, ToolState>>
  readonly commandIds: readonly string[]
}

/** A tool source: its kind and id */
export interface ToolSourceRef {
  kind: ToolSourceKind
  id: string
}

/** The built-in sources */
export const CORE_SOURCE_IDS = {
  files: 'files',
  web: 'web',
  memory: 'memory',
  replyBlocks: 'replyBlocks',
  attachments: 'attachments',
  debug: 'debug',
} as const

export const coreSource = (
  id: (typeof CORE_SOURCE_IDS)[keyof typeof CORE_SOURCE_IDS]
): ToolSourceRef => ({ kind: 'core', id })

export const FILES_SOURCE = coreSource(CORE_SOURCE_IDS.files)
export const WEB_SOURCE = coreSource(CORE_SOURCE_IDS.web)
export const MEMORY_SOURCE = coreSource(CORE_SOURCE_IDS.memory)
export const REPLY_BLOCKS_SOURCE = coreSource(CORE_SOURCE_IDS.replyBlocks)
export const ATTACHMENTS_SOURCE = coreSource(CORE_SOURCE_IDS.attachments)
export const DEBUG_SOURCE = coreSource(CORE_SOURCE_IDS.debug)
/** The user's commands, one tool each */
export const COMMANDS_SOURCE: ToolSourceRef = {
  kind: 'commands',
  id: 'commands',
}

/**
 * The core sources a profile always has, with no switch: memory follows the
 * profile's memory mode, the rest is part of every chat
 */
const ALWAYS_ON_CORE_IDS: ReadonlySet<string> = new Set([
  CORE_SOURCE_IDS.memory,
  CORE_SOURCE_IDS.replyBlocks,
  CORE_SOURCE_IDS.attachments,
  CORE_SOURCE_IDS.debug,
])

/** Whether a source is always on where it is offered, without settings */
export const isAlwaysOnSource = (source: ToolSourceRef) =>
  source.kind === 'core' && ALWAYS_ON_CORE_IDS.has(source.id)

/** The sources "Ask AI" may get: the web by its switch, and the helpers */
const ASK_AI_CORE_IDS: ReadonlySet<string> = new Set([
  CORE_SOURCE_IDS.web,
  CORE_SOURCE_IDS.replyBlocks,
  CORE_SOURCE_IDS.attachments,
  CORE_SOURCE_IDS.debug,
])

/** Escapes the separator of the keys; Rust has the same in `key_part` */
const keyPart = (part: string) =>
  part.replaceAll('%', '%25').replaceAll(':', '%3A')

/** The key of a source in the settings: `<kind>:<id>` */
export const sourceKey = (source: ToolSourceRef) =>
  `${keyPart(source.kind)}:${keyPart(source.id)}`

/** The key of a tool in the settings: `<kind>:<id>:<tool>` */
export const toolKey = (source: ToolSourceRef, toolName: string) =>
  `${sourceKey(source)}:${keyPart(toolName)}`

const RISK_ORDER: readonly ToolRisk[] = [
  'read',
  'write',
  'destructive',
  'external',
]

/** The highest of the risks; `read` for none */
export function highestRisk(risks: Iterable<ToolRisk>): ToolRisk {
  let highest: ToolRisk = 'read'
  for (const risk of risks)
    if (RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(highest)) highest = risk
  return highest
}

/** Whether the user is warned before giving a tool of this risk freely */
export const isRiskyTool = (risk: ToolRisk) =>
  risk === 'destructive' || risk === 'external'

/** What the catalog knows of a tool to decide on it */
export interface CatalogTool {
  source: ToolSourceRef
  name: string
  risk: ToolRisk
  /**
   * The policy when the user set none, over the one of its risk: the file tools
   * take theirs from the project permissions, say
   */
  defaultPolicy?: ToolPolicy
  /** A tool of a plugin that does not come with Tyco */
  isThirdParty?: boolean
}

/**
 * The policy of a tool the user set none for: `read` runs freely, the rest
 * asks. A risk declared by a third party never lowers it: such tools ask
 */
export function defaultToolPolicy(tool: CatalogTool): ToolPolicy {
  if (tool.defaultPolicy) return tool.defaultPolicy
  if (tool.source.kind === 'commands') return 'ask'
  if (tool.source.kind === 'plugin' && tool.isThirdParty) return 'ask'
  return tool.risk === 'read' ? 'allow' : 'ask'
}

/** Whether a profile has a source when it set nothing for it */
export const isSourceEnabledByDefault = (kind: ToolSourceKind) =>
  kind === 'core' || kind === 'plugin'

/** Whether a source is available at all: plugins and MCP servers can be off */
export function isSourceAvailable(
  catalog: ToolCatalogSettings | undefined,
  source: ToolSourceRef
): boolean {
  if (source.kind !== 'plugin' && source.kind !== 'mcp') return true
  return catalog?.sources[sourceKey(source)]?.isEnabled !== false
}

/** Whether the profile has the source on; commands are picked one by one */
export function isSourceEnabledInProfile(
  settings: ProfileToolSettingsView | undefined,
  source: ToolSourceRef
): boolean {
  if (isAlwaysOnSource(source)) return true
  if (source.kind === 'commands') return Boolean(settings?.commandIds.length)
  return (
    settings?.sources[sourceKey(source)]?.isEnabled ??
    isSourceEnabledByDefault(source.kind)
  )
}

/**
 * The state of a tool in a profile: off when its source is unavailable or off
 * in the profile, or the tool itself is; otherwise the profile's policy for it
 * or the default one
 */
export function effectiveToolState(
  catalog: ToolCatalogSettings | undefined,
  settings: ProfileToolSettingsView | undefined,
  tool: CatalogTool
): ToolState {
  if (!isSourceAvailable(catalog, tool.source)) return 'off'
  if (tool.source.kind === 'commands') {
    if (!settings?.commandIds.includes(tool.name)) return 'off'
  } else if (!isSourceEnabledInProfile(settings, tool.source)) return 'off'
  return (
    settings?.tools[toolKey(tool.source, tool.name)] ?? defaultToolPolicy(tool)
  )
}

/** The policy a profile runs a tool with; undefined when it is off */
export function effectiveToolPolicy(
  catalog: ToolCatalogSettings | undefined,
  settings: ProfileToolSettingsView | undefined,
  tool: CatalogTool
): ToolPolicy | undefined {
  const state = effectiveToolState(catalog, settings, tool)
  return state === 'off' ? undefined : state
}

/** Settings with nothing changed from the defaults */
export const emptyProfileToolSettings = (): ProfileToolSettings => ({
  sources: {},
  tools: {},
  commandIds: [],
})

const withoutKey = <T>(record: Record<string, T>, key: string) => {
  const { [key]: _removed, ...rest } = record
  return rest
}

/** The settings with a source switched; only a change from the default is kept */
export function withSourceEnabled(
  settings: ProfileToolSettings | undefined,
  source: ToolSourceRef,
  isEnabled: boolean
): ProfileToolSettings {
  const current = settings ?? emptyProfileToolSettings()
  const key = sourceKey(source)
  return {
    ...current,
    sources:
      isEnabled === isSourceEnabledByDefault(source.kind)
        ? withoutKey(current.sources, key)
        : { ...current.sources, [key]: { isEnabled } },
  }
}

/** The settings with a tool's state; only a change from the default is kept */
export function withToolState(
  settings: ProfileToolSettings | undefined,
  tool: CatalogTool,
  state: ToolState
): ProfileToolSettings {
  const current = settings ?? emptyProfileToolSettings()
  const key = toolKey(tool.source, tool.name)
  return {
    ...current,
    tools:
      state === defaultToolPolicy(tool)
        ? withoutKey(current.tools, key)
        : { ...current.tools, [key]: state },
  }
}

/** The settings with a command picked for the profile's chat, or not */
export function withCommandSelected(
  settings: ProfileToolSettings | undefined,
  commandId: string,
  isSelected: boolean
): ProfileToolSettings {
  const current = settings ?? emptyProfileToolSettings()
  const others = current.commandIds.filter((id) => id !== commandId)
  return {
    ...current,
    commandIds: isSelected ? [...others, commandId] : others,
  }
}

/** Whether a whitelist has a tool: its whole source or the tool itself */
export function whitelistHas(
  refs: readonly ToolRef[],
  source: ToolSourceRef,
  toolName: string
): boolean {
  return refs.some(
    (ref) =>
      ref.sourceKind === source.kind &&
      ref.sourceId === source.id &&
      (ref.toolName === undefined || ref.toolName === toolName)
  )
}

/** Whether two references name the same tool or source */
export const isSameToolRef = (a: ToolRef, b: ToolRef) =>
  a.sourceKind === b.sourceKind &&
  a.sourceId === b.sourceId &&
  a.toolName === b.toolName

/** The reference of a command in a whitelist */
export const commandToolRef = (commandId: string): ToolRef => ({
  sourceKind: 'commands',
  sourceId: COMMANDS_SOURCE.id,
  toolName: commandId,
})

/**
 * The risks of the core tools a whitelist may name. The web is `external` here:
 * an AI command reads any page without the chat's leak protection, so a chat
 * that hands it its data must ask as for a tool that sends data out
 */
const CORE_TOOL_RISKS: Readonly<Record<string, ToolRisk>> = {
  [CORE_SOURCE_IDS.web]: 'external',
}

/**
 * What an AI command may do, by its whitelist: no less than the riskiest tool
 * on it, so that the chat that calls it asks honestly
 */
export interface CommandRiskLookup {
  commands: readonly CommandConfig[]
  /** The whitelist of an AI command; undefined for another command */
  whitelistOf: (command: CommandConfig) => readonly ToolRef[] | undefined
  /** The risk of a plugin or MCP reference; `external` when unknown */
  externalRefRisk?: (ref: ToolRef) => ToolRisk | undefined
}

/**
 * The risk of a command an AI calls: the one the user gave it, `external` when
 * none; for an AI command, the highest risk on its whitelist
 */
export function commandRisk(
  command: CommandConfig,
  lookup: CommandRiskLookup,
  seen: ReadonlySet<string> = new Set()
): ToolRisk {
  const whitelist = lookup.whitelistOf(command)
  if (!whitelist) return command.aiRisk ?? 'external'
  const chain = new Set([...seen, command.id])
  return highestRisk(
    whitelist.map((ref) => {
      if (ref.sourceKind === 'core')
        return CORE_TOOL_RISKS[ref.sourceId] ?? 'external'
      if (ref.sourceKind === 'commands') {
        if (!ref.toolName || chain.has(ref.toolName)) return 'read'
        const inner = lookup.commands.find((item) => item.id === ref.toolName)
        return inner ? commandRisk(inner, lookup, chain) : 'read'
      }
      return lookup.externalRefRisk?.(ref) ?? 'external'
    })
  )
}

/** Where tools are offered, and what decides about them */
export type ToolScope =
  /** The "Ask AI" chat: the web by its switch and the helpers, never asking */
  | { kind: 'askAi'; isWebEnabled: boolean }
  /** A profile's chat: its settings, its memory mode */
  | {
      kind: 'profile'
      profileId: string
      settings: ProfileToolSettings | undefined
      catalog: ToolCatalogSettings | undefined
    }
  /** An AI command: its whitelist, all of it allowed */
  | {
      kind: 'aiCommand'
      commandId: string
      tools: readonly ToolRef[]
      catalog: ToolCatalogSettings | undefined
    }

/**
 * The state of a tool where it is offered: "Ask AI" and AI commands never ask,
 * a profile follows its settings
 */
export function toolStateIn(scope: ToolScope, tool: CatalogTool): ToolState {
  switch (scope.kind) {
    case 'askAi':
      if (tool.source.kind !== 'core' || !ASK_AI_CORE_IDS.has(tool.source.id))
        return 'off'
      if (tool.source.id === CORE_SOURCE_IDS.web && !scope.isWebEnabled)
        return 'off'
      return 'allow'
    case 'profile':
      if (isAlwaysOnSource(tool.source)) return tool.defaultPolicy ?? 'allow'
      return effectiveToolState(scope.catalog, scope.settings, tool)
    case 'aiCommand':
      return isSourceAvailable(scope.catalog, tool.source) &&
        whitelistHas(scope.tools, tool.source, tool.name)
        ? 'allow'
        : 'off'
  }
}

/** Where Rust is told a call comes from, to check it again */
export function toolCallContextOf(scope: ToolScope): ToolCallContext {
  switch (scope.kind) {
    case 'askAi':
      return { kind: 'askAi' }
    case 'profile':
      return { kind: 'profile', profileId: scope.profileId }
    case 'aiCommand':
      return { kind: 'aiCommand', commandId: scope.commandId }
  }
}
