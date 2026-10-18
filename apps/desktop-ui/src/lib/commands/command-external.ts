import type { CommandConfig } from '@tyco/shared'
import type { ToolLookup } from '../tools/tool-types'
import { isCommandAvailable } from './command-runtime'

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
function canRunCommandExternally(
  command: CommandConfig,
  tools: ToolLookup
): boolean {
  return (
    command.isEnabled &&
    command.availableIn.external &&
    isCommandAvailable(command, tools)
  )
}

/**
 * The other commands an external call by the name of `command` could mean as
 * well: such a call is refused as ambiguous
 */
export function findExternalCommandNameConflicts(
  commands: readonly CommandConfig[],
  command: CommandConfig,
  tools: ToolLookup
): CommandConfig[] {
  const name = normalizeCommandName(command.name)
  if (!name || !canRunCommandExternally(command, tools)) return []
  return commands.filter(
    (other) =>
      other.id !== command.id &&
      canRunCommandExternally(other, tools) &&
      normalizeCommandName(other.name) === name
  )
}

const shellQuote = (value: string): string =>
  /^[\w:.@-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`

/**
 * The shell line that runs the command from another application: by its name
 * when `byName`, otherwise by its id
 */
export function commandCliCall(target: string, byName = false): string {
  return `tyco-ctl run ${byName ? '--name ' : ''}${shellQuote(target)}`
}
