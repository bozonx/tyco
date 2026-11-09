import {
  BUILTIN_VARIABLES,
  variableNameIssue,
  variableReferences,
  type UserConfig,
  type VariableConfig,
  type VariableNameIssue,
} from '@tyco/shared'

import { renameVariable } from './command-variables'

type VariablesConfig = Pick<
  UserConfig,
  'variables' | 'variableValues' | 'commands' | 'llm'
>

/** What the user is told about a name that cannot be taken */
const NAME_ISSUE_KEYS: Readonly<Record<VariableNameIssue, string>> = {
  noName: 'variables.errorNoName',
  invalidName: 'variables.errorInvalidName',
  builtinName: 'variables.errorBuiltinName',
  nameTaken: 'variables.errorNameTaken',
}

/** Why `name` cannot be taken, as an i18n key */
const nameIssueKey = (
  name: string,
  variables: readonly VariableConfig[],
  ownId?: string
): string | undefined => {
  const issue = variableNameIssue(name, variables, ownId)
  return issue && NAME_ISSUE_KEYS[issue]
}

/** The longest variable id, as for every entity id */
const MAX_ID_LENGTH = 64

/** A stable id for a new variable named `name`, unique among `taken` */
export function newVariableId(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
      .slice(0, MAX_ID_LENGTH) || 'variable'
  let id = base
  for (let index = 2; taken.includes(id); index += 1) {
    const suffix = `-${index}`
    id = `${base.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`
  }
  return id
}

/**
 * Declares a variable, with `value` as its value on this device; returns why it
 * cannot be, as an i18n key. Other devices set their own value
 */
export function addVariable(
  config: VariablesConfig,
  name: string,
  value = ''
): { ok: true; variable: VariableConfig } | { ok: false; issueKey: string } {
  const trimmed = name.trim()
  const issueKey = nameIssueKey(trimmed, config.variables)
  if (issueKey) return { ok: false, issueKey }
  const variable: VariableConfig = {
    id: newVariableId(
      trimmed,
      config.variables.map((item) => item.id)
    ),
    name: trimmed,
  }
  config.variables = [variable, ...config.variables]
  setVariableValue(config, variable.id, value)
  return { ok: true, variable }
}

/**
 * Renames the variable `id`, and the references to it in the commands and the
 * base URLs of the providers; returns why it cannot be, as an i18n key
 */
export function renameVariableIn(
  config: VariablesConfig,
  id: string,
  name: string
): string | undefined {
  const trimmed = name.trim()
  const issueKey = nameIssueKey(trimmed, config.variables, id)
  if (issueKey) return issueKey
  const renamed = renameVariable(config, id, trimmed)
  config.variables = renamed.variables
  config.commands = renamed.commands
  config.llm = renamed.llm
  return undefined
}

/** Removes the declaration and the value this device has for it */
export function removeVariable(config: VariablesConfig, id: string): void {
  config.variables = config.variables.filter((variable) => variable.id !== id)
  setVariableValue(config, id, '')
}

/** Sets the value on this device; a blank one unsets it */
export function setVariableValue(
  config: VariablesConfig,
  id: string,
  value: string
): void {
  const { [id]: _previous, ...rest } = config.variableValues
  config.variableValues = value.trim() ? { ...rest, [id]: value } : rest
}

/** The declared variables without a value on this device */
export const unsetVariables = (
  config: Pick<UserConfig, 'variables' | 'variableValues'>
): VariableConfig[] =>
  config.variables.filter(
    (variable) => !config.variableValues[variable.id]?.trim()
  )

/**
 * What a `{{var:NAME}}` of a template lacks on this device: a value (`notSet`),
 * a declaration (`notDeclared`), a valid name (`invalidName`), or the case of a
 * declared name (`wrongCase`)
 */
export type VariableReferenceIssue =
  | { kind: 'notSet'; name: string; variableId: string }
  | { kind: 'notDeclared'; name: string }
  | { kind: 'invalidName'; name: string }
  | { kind: 'wrongCase'; name: string; expected: string }

const builtinNames: readonly string[] = BUILTIN_VARIABLES

/** The issues of the references in `templates`, each name once */
export function variableReferenceIssues(
  templates: readonly string[],
  config: Pick<UserConfig, 'variables' | 'variableValues'>
): VariableReferenceIssue[] {
  const names = new Set(templates.flatMap(variableReferences))
  return [...names].flatMap((name): VariableReferenceIssue[] => {
    if (builtinNames.includes(name)) return []
    const variable = config.variables.find((item) => item.name === name)
    if (variable)
      return config.variableValues[variable.id]?.trim()
        ? []
        : [{ kind: 'notSet', name, variableId: variable.id }]
    const upper = name.toUpperCase()
    const sameName = config.variables.find(
      (item) => item.name.toUpperCase() === upper
    )
    if (sameName) return [{ kind: 'wrongCase', name, expected: sameName.name }]
    return variableNameIssue(name, config.variables) === 'invalidName'
      ? [{ kind: 'invalidName', name }]
      : [{ kind: 'notDeclared', name }]
  })
}
