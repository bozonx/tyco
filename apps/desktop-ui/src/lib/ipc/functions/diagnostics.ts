import type { CommandRunRecord, ToolCatalogEntry } from '@tyco/shared'

export interface DiagnosticsFunctions {
  markActivationMetric: { args: [id: number, mark: string] }
  submitActivationMetricValue: { args: [id: number, value: string] }
  logCustomAction: { args: [name: string, actionType: string, details: string] }
  logCommandRun: { args: [record: CommandRunRecord] }
  openActionLog: { args: [] }
  setToolCatalog: { args: [tools: ToolCatalogEntry[]] }
}
