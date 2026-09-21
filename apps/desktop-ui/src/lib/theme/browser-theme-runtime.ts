import {
  applyAppearanceToDocument,
  onSystemAppearanceChange,
  readStoredAppearance,
  readSystemAppearance,
  writeStoredAppearance,
} from './document-appearance'
import type { ThemeRuntime } from './theme-controller'

export const browserThemeRuntime: ThemeRuntime = {
  getStoredAppearance: () => readStoredAppearance(window.localStorage),
  setStoredAppearance: (settings) => {
    writeStoredAppearance(window.localStorage, settings)
  },
  getSystemAppearance: readSystemAppearance,
  onSystemAppearanceChange,
  applyAppearance: (appearance) => {
    applyAppearanceToDocument(document.documentElement, appearance)
  },
}
