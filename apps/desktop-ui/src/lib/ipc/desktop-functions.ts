import type {
  DesktopCommandName,
  DesktopCommandResult,
  IpcResult,
} from '@tyco/shared'
import type { SettingsFunctions } from './functions/settings'
import type { WindowsFunctions } from './functions/windows'
import type { HistoryFunctions } from './functions/history'
import type { PluginsFunctions } from './functions/plugins'
import type { ActionsFunctions } from './functions/actions'
import type { HotkeysFunctions } from './functions/hotkeys'
import type { DiagnosticsFunctions } from './functions/diagnostics'
import type { StorageFunctions } from './functions/storage'
import type { ExternalFunctions } from './functions/external'

export interface DesktopFunctions
  extends
    SettingsFunctions,
    WindowsFunctions,
    HistoryFunctions,
    PluginsFunctions,
    ActionsFunctions,
    HotkeysFunctions,
    DiagnosticsFunctions,
    StorageFunctions,
    ExternalFunctions {}

export type DesktopFunctionName = keyof DesktopFunctions

export type DesktopFunctionArgs<K extends DesktopFunctionName> =
  DesktopFunctions[K]['args']

type SnakeCase<S extends string> = S extends `${infer Head}${infer Tail}`
  ? `${Head extends Lowercase<Head> ? Head : `_${Lowercase<Head>}`}${SnakeCase<Tail>}`
  : S

export type NativeCommand<K extends DesktopFunctionName> = Extract<
  SnakeCase<K>,
  DesktopCommandName
>

export type DesktopFunctionResult<K extends DesktopFunctionName> =
  DesktopCommandResult<NativeCommand<K>>

/** The arguments may be left out when a function takes none */
export type DesktopCallArgs<K extends DesktopFunctionName> =
  DesktopFunctionArgs<K> extends []
    ? [args?: []]
    : [args: DesktopFunctionArgs<K>]

export type DesktopCall = <K extends DesktopFunctionName>(
  name: K,
  ...args: DesktopCallArgs<K>
) => Promise<IpcResult<DesktopFunctionResult<K>>>
