export interface MainWindowResetDependencies {
  closeAllModals: () => void
  hasActiveInput?: () => boolean
  goToEditor: () => Promise<void>
}

/**
 * Closing the main window ends what was open in it: the next opening starts in
 * the editor, without the menus and results of the last time. Only the view
 * goes; the texts and the history stay. Pending modal operations are cancelled.
 * Hiding the window with a hotkey or the tray keeps everything.
 */
export function createMainWindowReset(deps: MainWindowResetDependencies) {
  return {
    async reset(): Promise<void> {
      if (deps.hasActiveInput?.()) return
      deps.closeAllModals()
      await deps.goToEditor()
    },
  }
}
