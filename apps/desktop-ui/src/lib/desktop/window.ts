import { isTauri } from '@tauri-apps/api/core'
import { DESKTOP_WINDOW_LABELS } from '@tyco/shared'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'

export const getDesktopWindow = () => getCurrentWindow()
export const getDesktopWebview = () => getCurrentWebview()
export const getDesktopWindowLabel = () =>
  isTauri() ? getCurrentWindow().label : DESKTOP_WINDOW_LABELS.MAIN
/** The quick window renders the overlays; every other window is a main one */
export const isQuickWindow = () =>
  getDesktopWindowLabel() === DESKTOP_WINDOW_LABELS.QUICK

export { convertFileSrc } from '@tauri-apps/api/core'
