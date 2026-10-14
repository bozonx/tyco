import type { DesktopCommandName, DesktopCommandArgs } from '@tyco/shared'
import type {
  DesktopFunctionName,
  DesktopFunctions,
  NativeCommand,
} from './desktop-functions'

interface CommandContext {
  activationId: number
}

export type CommandEntry<
  Args extends unknown[],
  C extends DesktopCommandName,
> = {
  command: C
  buildArgs: (args: Args, context: CommandContext) => DesktopCommandArgs<C>
  waitForKeysReleased?: boolean
}

export type DomainCommandMap<Names extends DesktopFunctionName> = {
  [K in Names]: DesktopCommandArgs<NativeCommand<K>> extends undefined
    ? Omit<
        CommandEntry<DesktopFunctions[K]['args'], NativeCommand<K>>,
        'buildArgs'
      > & { buildArgs?: never }
    : CommandEntry<DesktopFunctions[K]['args'], NativeCommand<K>>
}
