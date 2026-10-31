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
 * The other commands an external call by the name of each command could mean as
 * well, by command id: such a call is refused as ambiguous
 */
export function externalCommandNameConflicts(
  commands: readonly CommandConfig[],
  tools: ToolLookup
): Map<string, CommandConfig[]> {
  const byName = new Map<string, CommandConfig[]>()
  for (const command of commands) {
    const name = normalizeCommandName(command.name)
    if (!name || !canRunCommandExternally(command, tools)) continue
    byName.set(name, [...(byName.get(name) ?? []), command])
  }
  const conflicts = new Map<string, CommandConfig[]>()
  for (const group of byName.values()) {
    if (group.length < 2) continue
    for (const command of group)
      conflicts.set(
        command.id,
        group.filter((other) => other.id !== command.id)
      )
  }
  return conflicts
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
