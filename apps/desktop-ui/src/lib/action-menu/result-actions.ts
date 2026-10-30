import type { ActionItem } from '@tyco/plugin-sdk'

export interface ResultActionsDependencies {
  getShortcutActions: () => (ActionItem | undefined)[]
  getDefaultActions: () => ActionItem[]
  hasTargetWindow: () => boolean
  noTargetHint: () => string
  isEditorPage?: () => boolean
  replaceInEditorAction?: ActionItem
}

export function createResultActions(deps: ResultActionsDependencies) {
  return {
    shortcutActions() {
      return deps
        .getShortcutActions()
        .map((action) =>
          action?.id === 'insertIntoWindow' && !deps.hasTargetWindow()
            ? { ...action, disabled: true, hint: deps.noTargetHint() }
            : action
        )
    },
    primaryAction() {
      if (deps.isEditorPage?.() && deps.replaceInEditorAction) {
        return deps.replaceInEditorAction
      }
      const primary = deps.getDefaultActions()[0]
      if (!primary) return undefined
      return {
        ...primary,
        disabled: !deps.hasTargetWindow(),
        hint: deps.hasTargetWindow() ? primary.hint : deps.noTargetHint(),
      }
    },
  }
}
