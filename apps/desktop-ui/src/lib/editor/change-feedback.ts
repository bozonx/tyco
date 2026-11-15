import { StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

export const showChangeFeedback = StateEffect.define<{
  from: number
  to: number
} | null>()

const feedbackField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none
    for (const effect of transaction.effects) {
      if (!effect.is(showChangeFeedback)) continue
      const range = effect.value
      value =
        range && range.from < range.to
          ? Decoration.set([
              Decoration.mark({ class: 'cm-change-feedback' }).range(
                range.from,
                range.to
              ),
            ])
          : Decoration.none
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * Applied result feedback is outside undo history and expires without changing
 * selection.
 */
export const changeFeedback: Extension = [
  feedbackField,
  ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | undefined
      constructor(private view: EditorView) {}
      update(update: ViewUpdate) {
        if (
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(showChangeFeedback))
          )
        ) {
          clearTimeout(this.timer)
          this.timer = undefined
        }
        const hasFeedback = this.view.state.field(feedbackField).size > 0
        if (!hasFeedback) {
          clearTimeout(this.timer)
          this.timer = undefined
        } else if (this.timer === undefined) {
          this.timer = setTimeout(() => {
            this.timer = undefined
            this.view.dispatch({ effects: showChangeFeedback.of(null) })
          }, 650)
        }
      }
      destroy() {
        clearTimeout(this.timer)
      }
    }
  ),
  EditorView.baseTheme({
    '.cm-change-feedback': {
      backgroundColor: 'var(--app-accent-soft)',
      textDecoration: 'var(--app-diff-added-decoration, none)',
      animation: 'editor-change-feedback 650ms ease-out forwards',
    },
    '@keyframes editor-change-feedback': {
      from: { backgroundColor: 'var(--app-accent-soft)' },
      to: { backgroundColor: 'transparent' },
    },
    '@media (prefers-reduced-motion: reduce)': {
      '.cm-change-feedback': { animation: 'none' },
    },
    '&[data-motion="reduce"] .cm-change-feedback': { animation: 'none' },
  }),
]
