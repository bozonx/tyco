import type { HotkeyApplyResult, HotkeyProviderInfo } from '@tyco/shared'

export interface HotkeySettingsState {
  canConfigure: boolean
  statuses: Record<string, HotkeyApplyResult>
}

export function applyProviderInfo(
  state: HotkeySettingsState,
  info: HotkeyProviderInfo
): void {
  state.canConfigure = info.canConfigure
  state.statuses = { ...info.actions }
}
