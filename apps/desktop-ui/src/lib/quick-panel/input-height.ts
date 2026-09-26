export interface InputHeightLayout {
  /** Height of the column holding the input and its hint. */
  containerHeight: number
  /** Height of everything in the column besides the input frame. */
  siblingsHeight: number
  /** Gaps between the column items. */
  gapsHeight: number
  /** Borders and paddings of the frame around the text area. */
  frameChromeHeight: number
}

/** The text area never gets shorter than one line of it. */
export const MIN_INPUT_HEIGHT = 36

/**
 * The tallest the auto-growing text area may get: it grows until the frame
 * reaches the top of the column, then scrolls
 */
export function maxInputHeight(layout: InputHeightLayout): number {
  const available =
    layout.containerHeight -
    layout.siblingsHeight -
    layout.gapsHeight -
    layout.frameChromeHeight
  return Math.max(MIN_INPUT_HEIGHT, Math.floor(available))
}
