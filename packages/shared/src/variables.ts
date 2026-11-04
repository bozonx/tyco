import {
  ACTION_SELECTION_PLACEHOLDER,
  ACTION_TEXT_PLACEHOLDER,
} from './user-config/commands-config'

/**
 * A variable of the commands: the user data declares its name once, each device
 * sets its own value (`variableValues`, kept on the device). A template refers
 * to it as `{{var:NAME}}`. Keep the rules in sync with `services/variables.rs`;
 * `fixtures/variable-substitution.json` checks both
 */
export interface VariableConfig {
  /** Stable; the device keeps its value under it */
  id: string
  /** What templates refer to, e.g. `NOTES_DIR` */
  name: string
  description: string
}

/** What a variable name looks like */
export const VARIABLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/
/** The longest variable name */
export const MAX_VARIABLE_NAME_LENGTH = 64
/** The prefix of the built-in variables; a variable of the user never has it */
export const BUILTIN_VARIABLE_PREFIX = 'TYCO_'
/** The built-in variables: the user data folder and the id of this device */
export const BUILTIN_VARIABLES = ['TYCO_USER_DIR', 'TYCO_DEVICE_ID'] as const

/**
 * Where a template is filled, which decides how a value is escaped: as it is in
 * a prompt (`text`), a URL and a header value (no line break there), and by the
 * rules of `{{TEXT}}` in the body of a webhook (`json`). Scripts are filled by
 * the backend, see `services/platform/shell.rs`
 */
export type VariablePlace = 'text' | 'url' | 'header' | 'json'

/** The values variables have on this device, by name; one unset is absent */
export type VariableValues = Readonly<Record<string, string>>

const REFERENCE_SOURCE = String.raw`\{\{var:([A-Za-z_][A-Za-z0-9_]*)\}\}`

/** `{{var:NAME}}` */
export const variablePlaceholder = (name: string): string => `{{var:${name}}}`

/** The names `template` refers to, each once, in their order */
export function variableReferences(template: string): string[] {
  const names = new Set<string>()
  for (const match of template.matchAll(new RegExp(REFERENCE_SOURCE, 'g')))
    names.add(match[1]!)
  return [...names]
}

/** The names `templates` refer to that have no value in `values` */
export function missingVariables(
  templates: readonly string[],
  values: VariableValues
): string[] {
  const names = new Set<string>()
  for (const template of templates)
    for (const name of variableReferences(template))
      if (!Object.hasOwn(values, name)) names.add(name)
  return [...names]
}

/** Why a name cannot name a variable of the user */
export type VariableNameIssue =
  'noName' | 'invalidName' | 'builtinName' | 'nameTaken'

/**
 * Why `name` cannot name a variable of the user, `ownId` being the variable it
 * is given to; names are compared without case
 */
export function variableNameIssue(
  name: string,
  variables: readonly VariableConfig[],
  ownId?: string
): VariableNameIssue | undefined {
  if (!name) return 'noName'
  if (
    !VARIABLE_NAME_PATTERN.test(name) ||
    name.length > MAX_VARIABLE_NAME_LENGTH
  )
    return 'invalidName'
  if (name.startsWith(BUILTIN_VARIABLE_PREFIX)) return 'builtinName'
  const upper = name.toUpperCase()
  if (
    variables.some(
      (variable) =>
        variable.id !== ownId && variable.name.toUpperCase() === upper
    )
  )
    return 'nameTaken'
  return undefined
}

/** What the built-in variables stand for on this device */
export interface BuiltinVariableValues {
  userDir: string
  deviceId: string
}

/**
 * The values of the variables on this device: each declared one with the value
 * the device set, and the built-in ones
 */
export function variableValuesOf(
  config: {
    variables: readonly VariableConfig[]
    variableValues: Readonly<Record<string, string>>
  },
  builtins: BuiltinVariableValues
): VariableValues {
  const values: Record<string, string> = {}
  for (const variable of config.variables) {
    const value = config.variableValues[variable.id]
    if (value?.trim()) values[variable.name] = value
  }
  if (builtins.userDir) values.TYCO_USER_DIR = builtins.userDir
  if (builtins.deviceId) values.TYCO_DEVICE_ID = builtins.deviceId
  return values
}

export type VariableSubstitution =
  | { ok: true; value: string }
  /** Variables without a value on this device */
  | { ok: false; missing: string[] }
  /** A value cannot go there, e.g. a line break into a header */
  | { ok: false; missing: []; invalidName: string }

const TOKEN_SOURCE = String.raw`\{\{TEXT\}\}|\{\{SELECTION\}\}|${REFERENCE_SOURCE}`

function isJson(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

/**
 * `template` with the variables filled for `place`, once: what a value holds
 * stays text. `text` fills `{{TEXT}}` too, `null` with nothing; without it
 * `{{TEXT}}` stays as it is. In a URL the text is encoded, a variable is not,
 * so that it may hold a base address
 */
export function substituteVariables(
  template: string,
  values: VariableValues,
  place: VariablePlace,
  text?: string | null,
  selection?: string | null
): VariableSubstitution {
  const missing = missingVariables([template], values)
  if (missing.length) return { ok: false, missing }
  if (place === 'header') {
    const invalidName = variableReferences(template).find((name) =>
      /[\r\n]/.test(values[name]!)
    )
    if (invalidName) return { ok: false, missing: [], invalidName }
  }
  const textValue =
    text === undefined
      ? undefined
      : place === 'url'
        ? encodeURIComponent(text ?? '')
        : (text ?? '')
  const selectionValue =
    selection === undefined
      ? undefined
      : place === 'url'
        ? encodeURIComponent(selection ?? '')
        : (selection ?? '')
  const valueOf = (token: string, name: string | undefined) => {
    if (name !== undefined) return values[name]!
    if (token === ACTION_SELECTION_PLACEHOLDER) return selectionValue ?? token
    return textValue ?? token
  }
  if (place === 'json') return { ok: true, value: fillBody(template, valueOf) }
  return {
    ok: true,
    value: template.replace(
      new RegExp(TOKEN_SOURCE, 'g'),
      (token, name: string | undefined) => valueOf(token, name)
    ),
  }
}

/**
 * The body of a webhook: the text alone is sent as it is; in a JSON template a
 * value is escaped inside a string, `"{{TEXT}}"` included, or becomes a JSON
 * string of its own when bare; any other template takes the values as they are
 */
function fillBody(
  template: string,
  valueOf: (token: string, name: string | undefined) => string
): string {
  if (template.trim() === ACTION_TEXT_PLACEHOLDER)
    return valueOf(ACTION_TEXT_PLACEHOLDER, undefined)
  if (template.trim() === ACTION_SELECTION_PLACEHOLDER)
    return valueOf(ACTION_SELECTION_PLACEHOLDER, undefined)
  if (isJson(fillJson(template, () => ''))) return fillJson(template, valueOf)
  return template.replace(
    new RegExp(TOKEN_SOURCE, 'g'),
    (token, name: string | undefined) => valueOf(token, name)
  )
}

/** `template` filled as JSON, see `fillBody` */
function fillJson(
  template: string,
  valueOf: (token: string, name: string | undefined) => string
): string {
  return template.replace(
    new RegExp(String.raw`"((?:[^"\\]|\\.)*)"|${TOKEN_SOURCE}`, 'g'),
    (match, inner: string | undefined, name: string | undefined) =>
      inner === undefined
        ? JSON.stringify(valueOf(match, name))
        : `"${inner.replace(
            new RegExp(TOKEN_SOURCE, 'g'),
            (token, innerName: string | undefined) =>
              JSON.stringify(valueOf(token, innerName)).slice(1, -1)
          )}"`
  )
}

/**
 * `template` with `{{var:from}}` renamed to `{{var:to}}`, for a renamed
 * variable
 */
export const renameVariableReferences = (
  template: string,
  from: string,
  to: string
): string =>
  template.split(variablePlaceholder(from)).join(variablePlaceholder(to))

/** What a variable at the start of a URL template is checked as */
const SAMPLE_BASE_URL = 'https://variable.invalid'

/**
 * A URL template as it is checked when saved, before any device fills it: a
 * variable at its start stands for an absolute `http(s)` address, any other for
 * a word, as does `{{TEXT}}`. The template is valid when the result is a valid
 * URL, i.e. the variables stand at the start or in the path or query
 */
export function sampleUrlTemplate(template: string): string {
  return template
    .trim()
    .replace(new RegExp(`^${REFERENCE_SOURCE}`), SAMPLE_BASE_URL)
    .replace(new RegExp(TOKEN_SOURCE, 'g'), 'x')
}
