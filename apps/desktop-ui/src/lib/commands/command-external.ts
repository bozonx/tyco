import type { CommandConfig } from '@tyco/shared'
import type { ToolLookup } from '../tools/tool-types'
import { isCommandAvailable } from './command-runtime'

/**
 * A name as external calls compare it: case, `ё` and spaces do not matter. Keep
 * in sync with `normalize_name` in `services/external/command_library.rs`
 */
export function normalizeCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/\p{White_Space}+/u)
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
    command.isAvailableExternally &&
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

/** The shell the copied line is for: POSIX sh or Windows PowerShell */
export type CliShell = 'posix' | 'powershell'

/** The value as one word of the shell; plain words stay as they are */
function shellQuote(value: string, shell: CliShell): string {
  if (/^[\w:.@-]+$/.test(value)) return value
  return shell === 'powershell'
    ? `'${value.replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&')}'`
    : `'${value.replaceAll("'", "'\\''")}'`
}

/** The shell of the platform the app runs on */
export function platformCliShell(userAgent: string): CliShell {
  return /Windows/i.test(userAgent) ? 'powershell' : 'posix'
}

/**
 * The shell line that runs the command from another application: by its name
 * when `byName`, otherwise by its id
 */
export function commandCliCall(
  target: string,
  byName = false,
  shell: CliShell = 'posix'
): string {
  return `tyco-ctl run ${byName ? '--name ' : ''}${shellQuote(target, shell)}`
}
