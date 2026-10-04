export interface MainWindowResetDeps {
  closeAllModals: () => void
  goToEditor: () => Promise<void>
}

/**
 * Closing the main window ends what was open in it: the next opening starts in
 * the editor, without the menus and results of the last time. Only the view
 * goes; the texts and the history stay. An operation still running is not
 * cancelled: its result goes to the history, but no longer shows up. Hiding the
 * window with a hotkey or the tray keeps everything
 */
export function createMainWindowReset(deps: MainWindowResetDeps) {
  return {
    async reset(): Promise<void> {
      deps.closeAllModals()
      await deps.goToEditor()
    },
  }
}
