export interface HotkeysFunctions {
  applyHotkey: { args: [request: { mode: string; shortcut: string }] }
  configureHotkeys: { args: [] }
  rebindHotkeys: { args: [] }
  suspendHotkeys: { args: [suspended: boolean] }
  getHotkeyProviderInfo: { args: [] }
}
