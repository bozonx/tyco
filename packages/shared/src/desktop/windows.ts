/**
 * The labels of the app's windows. They mirror `MAIN_WINDOW_LABEL` and the
 * command executor labels in `src-tauri/src/services/runtime.rs`; a test there
 * fails when the two drift apart.
 */
export const DESKTOP_WINDOW_LABELS = {
  MAIN: 'main',
  /** Renders the overlays opened by global hotkeys */
  QUICK: 'quick',
  /** Executes quiet jobs independently of the quick window */
  QUIET: 'quiet',
  /** The subtitles of the dialog, over every window */
  SUBTITLES: 'subtitles',
} as const
