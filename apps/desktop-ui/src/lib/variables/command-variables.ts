import {
  missingVariables,
  renameVariableReferences,
  substituteVariables,
  variableValuesOf,
  type CommandConfig,
  type LlmConfig,
  type LlmProvider,
  type UserConfig,
  type UserDataState,
  type VariableSubstitution,
  type VariableValues,
} from '@tyco/shared'

import { secretIdFromRef } from '../net/secrets'

/**
 * What decides whether a command runs on this device: the platform, for the
 * `platforms` of a command, and the values of the variables here
 */
export interface CommandEnvironment {
  platform: string
  variables: VariableValues
}

/** The fields of a tool's settings that take `{{var:NAME}}` */
const VARIABLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  script: ['command', 'workingDirectory'],
  webhook: ['url', 'payloadTemplate'],
  'core.aiTask': ['prompt'],
}

/** The names of the fields of `toolId` that take variables */
const variableFieldsOf = (toolId: string): readonly string[] =>
  VARIABLE_FIELDS[toolId] ?? []

/** Whether `value` of a webhook header is plain text, not a key reference */
const isPlainHeader = (value: unknown): value is string =>
  typeof value === 'string' && !secretIdFromRef(value)

/**
 * The texts of a command's settings that may refer to variables: those the run
 * fills. A webhook's body counts only for a POST request
 */
function commandVariableTemplates(
  toolId: string,
  toolConfig: Record<string, unknown>
): string[] {
  const texts: string[] = []
  for (const field of variableFieldsOf(toolId)) {
    if (
      toolId === 'webhook' &&
      field === 'payloadTemplate' &&
      toolConfig.method === 'GET'
    )
      continue
    const value = toolConfig[field]
    if (typeof value === 'string') texts.push(value)
  }
  if (toolId === 'webhook' && toolConfig.headers) {
    for (const value of Object.values(
      toolConfig.headers as Record<string, unknown>
    ))
      if (isPlainHeader(value)) texts.push(value)
  }
  return texts
}

/** The variables the command refers to that have no value on this device */
export const commandMissingVariables = (
  command: Pick<CommandConfig, 'toolId' | 'toolConfig'>,
  variables: VariableValues
): string[] =>
  missingVariables(
    commandVariableTemplates(command.toolId, command.toolConfig),
    variables
  )

/** Whether the command runs on `platform`: it names none, or that one */
export const isOnPlatform = (
  platforms: readonly string[] | undefined,
  platform: string
): boolean => !platforms?.length || platforms.includes(platform)

/** The fields `{{var:from}}` is renamed in, see `renameVariable` */
function renameInToolConfig(
  toolId: string,
  toolConfig: Record<string, unknown>,
  from: string,
  to: string
): Record<string, unknown> {
  const fields = variableFieldsOf(toolId)
  if (!fields.length) return toolConfig
  const next = { ...toolConfig }
  for (const field of fields)
    if (typeof next[field] === 'string')
      next[field] = renameVariableReferences(next[field], from, to)
  if (toolId === 'webhook' && next.headers) {
    next.headers = Object.fromEntries(
      Object.entries(next.headers as Record<string, unknown>).map(
        ([name, value]) => [
          name,
          isPlainHeader(value)
            ? renameVariableReferences(value, from, to)
            : value,
        ]
      )
    )
  }
  return next
}

/**
 * The parts of `config` that change when the variable `from` is renamed to
 * `to`: its declaration, and the references of the commands and of the base
 * URLs of the providers, which refer to it by name
 */
export function renameVariable(
  config: Pick<UserConfig, 'variables' | 'commands' | 'llm'>,
  id: string,
  to: string
): Pick<UserConfig, 'variables' | 'commands'> & { llm: LlmConfig } {
  const from = config.variables.find((variable) => variable.id === id)?.name
  const variables = config.variables.map((variable) =>
    variable.id === id ? { ...variable, name: to } : variable
  )
  if (!from || from === to)
    return { variables, commands: config.commands, llm: config.llm }
  return {
    variables,
    commands: config.commands.map((command) => {
      const toolConfig = renameInToolConfig(
        command.toolId,
        command.toolConfig,
        from,
        to
      )
      return toolConfig === command.toolConfig
        ? command
        : { ...command, toolConfig }
    }),
    llm: {
      ...config.llm,
      providers: config.llm.providers.map((provider) =>
        provider.type === 'openaiCompatible'
          ? {
              ...provider,
              baseUrl: renameVariableReferences(
                provider.baseUrl ?? '',
                from,
                to
              ),
            }
          : provider
      ),
    },
  }
}

/** The commands and providers that refer to the variable `name` */
export function variableUsage(
  config: Pick<UserConfig, 'commands' | 'llm'> &
    Partial<Pick<UserConfig, 'variables' | 'variableValues'>>,
  name: string
): { commandIds: string[]; providerIds: string[]; variableIds: string[] } {
  const refers = (text: string) => text.includes(`{{var:${name}}}`)
  return {
    variableIds: (config.variables ?? [])
      .filter(
        (variable) =>
          variable.name !== name &&
          refers(config.variableValues?.[variable.id] ?? '')
      )
      .map((variable) => variable.id),
    commandIds: config.commands
      .filter((command) =>
        commandVariableTemplates(command.toolId, command.toolConfig).some(
          refers
        )
      )
      .map((command) => command.id),
    providerIds: config.llm.providers
      .filter(
        (provider) =>
          provider.type === 'openaiCompatible' && refers(provider.baseUrl ?? '')
      )
      .map((provider) => provider.id),
  }
}

/**
 * The values of the variables on this device, from the joined config and the
 * user data state of the backend
 */
export const deviceVariableValues = (
  config: Pick<UserConfig, 'variables' | 'variableValues'> | undefined,
  userData: Pick<UserDataState, 'path' | 'deviceId'> | undefined
): VariableValues =>
  variableValuesOf(
    {
      variables: config?.variables ?? [],
      variableValues: config?.variableValues ?? {},
    },
    { userDir: userData?.path ?? '', deviceId: userData?.deviceId ?? '' }
  )

/**
 * The base URL of a custom provider as it is on this device; see
 * `substituteVariables`
 */
export const providerBaseUrl = (
  provider: LlmProvider,
  variables: VariableValues
): VariableSubstitution =>
  substituteVariables((provider.baseUrl ?? '').trim(), variables, 'url')

/**
 * The LLM settings with the base URLs of this device. A provider whose URL
 * refers to a variable without a value here gets none, so that its models are
 * not offered rather than sent to a wrong address
 */
export function withProviderVariables(
  llm: LlmConfig,
  variables: VariableValues
): LlmConfig {
  return {
    ...llm,
    providers: llm.providers.map((provider) => {
      if (provider.type !== 'openaiCompatible') return provider
      const url = providerBaseUrl(provider, variables)
      return { ...provider, baseUrl: url.ok ? url.value : '' }
    }),
  }
}
