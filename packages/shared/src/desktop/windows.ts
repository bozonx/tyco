/**
 * The labels of the app's windows. They mirror `MAIN_WINDOW_LABEL` and
 * `QUICK_WINDOW_LABEL` in `src-tauri/src/services/runtime.rs`; a test there
 * fails when the two drift apart.
 */
export const DESKTOP_WINDOW_LABELS = {
  MAIN: 'main',
  /** Renders the overlays opened by global hotkeys */
  QUICK: 'quick',
} as const
