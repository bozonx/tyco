import type { StatusOverlayRequest, ScriptActionRequest } from '@tyco/shared'

export interface ActionsFunctions {
  finishSelectionRun: { args: [runId: number, text: string | null] }
  showStatusOverlay: { args: [request: StatusOverlayRequest | null] }
  notifyDesktop: { args: [summary: string, body: string] }
  checkTextInjection: { args: [] }
  saveNote: { args: [dir: string, fileName: string, text: string] }
  appendNote: { args: [dir: string, fileName: string, text: string] }
  executeScriptAction: { args: [request: ScriptActionRequest] }
  cancelScriptAction: { args: [runId: string] }
  pickScriptFile: { args: [] }
  pickDirectory: { args: [] }
  copyText: { args: [text: string] }
  replaceSelectionWithCommand: { args: [commandId: string] }
}
