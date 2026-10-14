export interface MainWindowResetDependencies {
  closeAllModals: () => void
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
      deps.closeAllModals()
      await deps.goToEditor()
    },
  }
}
