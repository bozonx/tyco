import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'

export const getDesktopWindow = () => getCurrentWindow()
export const getDesktopWebview = () => getCurrentWebview()
export const getDesktopWindowLabel = () =>
  isTauri() ? getCurrentWindow().label : 'main'
/** The quick window renders the overlays; every other window is a main one */
export const isQuickWindow = () => getDesktopWindowLabel() === 'quick'

export { convertFileSrc } from '@tauri-apps/api/core'
