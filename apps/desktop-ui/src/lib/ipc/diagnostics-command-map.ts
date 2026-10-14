import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { DiagnosticsFunctions } from './functions/diagnostics'
import type { DomainCommandMap } from './command-types'

export function createDiagnosticsCommandMap(): DomainCommandMap<
  keyof DiagnosticsFunctions
> {
  return {
    markActivationMetric: {
      command: DESKTOP_COMMANDS.MARK_ACTIVATION_METRIC,
      buildArgs: ([id, mark]) =>
        ({ id, mark }) satisfies DesktopCommandArgs<'mark_activation_metric'>,
    },
    submitActivationMetricValue: {
      command: DESKTOP_COMMANDS.SUBMIT_ACTIVATION_METRIC_VALUE,
      buildArgs: ([id, value]) =>
        ({
          id,
          value,
        }) satisfies DesktopCommandArgs<'submit_activation_metric_value'>,
    },
    logCustomAction: {
      command: DESKTOP_COMMANDS.LOG_CUSTOM_ACTION,
      buildArgs: ([name, actionType, details]) =>
        ({
          name,
          actionType,
          details,
        }) satisfies DesktopCommandArgs<'log_custom_action'>,
    },
    logCommandRun: {
      command: DESKTOP_COMMANDS.LOG_COMMAND_RUN,
      buildArgs: ([record]) =>
        ({ record }) satisfies DesktopCommandArgs<'log_command_run'>,
    },
    openActionLog: { command: DESKTOP_COMMANDS.OPEN_ACTION_LOG },
    setToolCatalog: {
      command: DESKTOP_COMMANDS.SET_TOOL_CATALOG,
      buildArgs: ([tools]) =>
        ({ tools }) satisfies DesktopCommandArgs<'set_tool_catalog'>,
    },
  }
}
