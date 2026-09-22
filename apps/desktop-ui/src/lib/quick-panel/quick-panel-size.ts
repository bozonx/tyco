export const QUICK_PANEL_WIDTH = 800
export const QUICK_PANEL_MIN_HEIGHT = 96
export const QUICK_PANEL_MAX_HEIGHT = 320
export const QUICK_PANEL_WINDOW_GAP = 16

export function quickPanelWindowHeight(contentHeight: number): number {
  const desiredHeight = Math.ceil(contentHeight) + QUICK_PANEL_WINDOW_GAP

  return Math.min(
    QUICK_PANEL_MAX_HEIGHT,
    Math.max(QUICK_PANEL_MIN_HEIGHT, desiredHeight)
  )
}
