import { computed } from 'vue'

export interface SelectionActionContextDependencies {
  desktopSelectedText: () => string | null | undefined
  editorSelectedText: () => string | null | undefined
  editorText: () => string | null | undefined
  isWindowShown: () => boolean
  hasOpenModal: () => boolean
}

export function createSelectionActionContext(
  deps: SelectionActionContextDependencies
) {
  return {
    text: computed(
      () =>
        deps.desktopSelectedText() ||
        deps.editorSelectedText() ||
        deps.editorText() ||
        ''
    ),
    // Hidden views must not consume keys intended for the next activation.
    shortcutsDisabled: computed(
      () => deps.hasOpenModal() || !deps.isWindowShown()
    ),
  }
}
