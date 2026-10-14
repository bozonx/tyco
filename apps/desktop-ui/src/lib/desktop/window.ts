import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'

export const getDesktopWindow = () => getCurrentWindow()
export const getDesktopWebview = () => getCurrentWebview()
export const getDesktopWindowLabel = () =>
  isTauri() ? getCurrentWindow().label : 'main'

export { convertFileSrc } from '@tauri-apps/api/core'
