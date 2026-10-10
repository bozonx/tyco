import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import { Compartment, StateEffect, StateField } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { Decoration, EditorView } from '@codemirror/view'

import { MarkerWidget, PreviewWidget } from './preview-widget'
import { editorHighlightStyle } from './theme'

/** A span of the document hidden while the caret is elsewhere */
export interface HiddenRange {
  from: number
  to: number
}

const ATX_HEADING = /^ATXHeading[1-6]$/

/** Lines touched by the selection: their markup stays visible for editing */
const activeLines = (state: EditorState): { from: number; to: number } => {
  const { from, to } = state.selection.main

  return { from: state.doc.lineAt(from).from, to: state.doc.lineAt(to).to }
}

/**
 * The markup characters to hide in `[from, to)`: emphasis and strikethrough
 * marks, inline code backticks, `#` of headings with the space after them and
 * the `](url)` part of inline links. Lines touched by the selection keep
 * everything, so the caret never edits text it cannot see.
 */
export const hiddenMarkup = (
  state: EditorState,
  from = 0,
  to = state.doc.length,
  revealSelection = true
): HiddenRange[] => {
  const active = activeLines(state)
  const ranges: HiddenRange[] = []
  const hide = (start: number, end: number) => {
    if (end <= start) return
    if (revealSelection && start <= active.to && end >= active.from) return
    ranges.push({ from: start, to: end })
  }

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      const parent = node.node.parent?.name ?? ''

      switch (node.name) {
        case 'EmphasisMark':
        case 'StrikethroughMark':
          hide(node.from, node.to)
          return
        case 'CodeMark':
          // the fences of a code block are not inline markup
          if (parent === 'InlineCode') hide(node.from, node.to)
          return
        case 'HeaderMark': {
          if (!ATX_HEADING.test(parent)) return
          const next = state.doc.sliceString(node.to, node.to + 1)
          hide(node.from, next === ' ' ? node.to + 1 : node.to)
          return
        }
        case 'Link': {
          const marks = node.node.getChildren('LinkMark')
          // `[text](url)`: four marks; references and autolinks keep theirs
          if (marks.length < 4 || !node.node.getChild('URL')) return
          const [open, close] = marks
          hide(open!.from, open!.to)
          hide(close!.from, node.to)
          // emphasis inside the link text is hidden as anywhere else
          return
        }
        default:
          return
      }
    },
  })

  return ranges
}

const previewFocus = StateEffect.define<boolean>()

/** Only selection-touched lines expose their source while the editor has focus. */
const touchesSelection = (
  state: EditorState,
  from: number,
  to: number,
  focused: boolean
): boolean => {
  if (!focused) return false
  const active = activeLines(state)
  return from <= active.to && to >= active.from
}

export const previewDecorations = (
  state: EditorState,
  focused: boolean
): DecorationSet => {
  const decorations: Range<Decoration>[] = []
  const replaced: HiddenRange[] = []
  const replace = (
    from: number,
    to: number,
    widget?: PreviewWidget | MarkerWidget,
    block = false
  ) => {
    if (to <= from) return
    replaced.push({ from, to })
    decorations.push(
      Decoration.replace({ widget, block, previewAtomic: true }).range(from, to)
    )
  }
  const lines = (from: number, to: number, className: string) => {
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number
    for (let number = first; number <= last; number++) {
      decorations.push(
        Decoration.line({ class: className }).range(state.doc.line(number).from)
      )
    }
  }
  syntaxTree(state).iterate({
    enter(node) {
      const active = touchesSelection(state, node.from, node.to, focused)
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name)
      if (heading) {
        lines(
          node.from,
          node.to,
          `cm-preview-heading cm-preview-h${heading[1]}`
        )
        if (node.name.startsWith('Setext') && !active) {
          const underline = state.doc.lineAt(node.to)
          replace(underline.from - 1, underline.to)
        }
      }
      switch (node.name) {
        case 'Table':
        case 'Image':
        case 'HorizontalRule': {
          if (active) return false
          const kind =
            node.name === 'Table'
              ? 'table'
              : node.name === 'Image'
                ? 'image'
                : 'rule'
          replace(
            node.from,
            node.to,
            new PreviewWidget(
              state.sliceDoc(node.from, node.to),
              node.from,
              kind
            ),
            kind !== 'image'
          )
          return false
        }
        case 'Blockquote':
          lines(node.from, node.to, 'cm-preview-quote')
          break
        case 'QuoteMark':
          if (!active)
            replace(
              node.from,
              node.to + (state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0)
            )
          break
        case 'ListItem':
          lines(node.from, node.to, 'cm-preview-list-item')
          break
        case 'ListMark':
          if (!active) {
            const task = node.node.parent?.getChild('Task')
            replace(
              node.from,
              node.to,
              task
                ? undefined
                : new MarkerWidget(
                    /^\d/.test(state.sliceDoc(node.from, node.to))
                      ? state.sliceDoc(node.from, node.to)
                      : '•',
                    node.from
                  )
            )
          }
          break
        case 'TaskMarker':
          if (!active)
            replace(
              node.from,
              node.to,
              new MarkerWidget(
                '',
                node.from,
                /[xX]/.test(state.sliceDoc(node.from, node.to))
              )
            )
          break
        case 'InlineCode':
          decorations.push(
            Decoration.mark({ class: 'cm-preview-inline-code' }).range(
              node.from,
              node.to
            )
          )
          break
        case 'FencedCode':
        case 'CodeBlock':
          lines(node.from, node.to, 'cm-preview-code-block')
          if (node.name === 'FencedCode' && !active) {
            const first = state.doc.lineAt(node.from)
            const last = state.doc.lineAt(node.to)
            // Only collapse fence lines when a body remains editable.
            if (last.number > first.number + 1) {
              replace(first.from, first.to + 1)
              if (node.node.getChildren('CodeMark').length > 1)
                replace(last.from - 1, last.to)
            }
          }
          return false
      }
      return undefined
    },
  })
  for (const range of hiddenMarkup(state, 0, state.doc.length, focused)) {
    if (
      !replaced.some((other) => range.from < other.to && range.to > other.from)
    ) {
      decorations.push(
        Decoration.replace({ previewAtomic: true }).range(range.from, range.to)
      )
    }
  }
  // A collapsed block owns its contents, including nested quote/list markers.
  return Decoration.set(
    decorations.filter(
      (range) =>
        !range.value.spec.previewAtomic ||
        !replaced.some(
          (outer) =>
            outer.from <= range.from &&
            outer.to >= range.to &&
            (outer.from < range.from || outer.to > range.to)
        )
    ),
    true
  )
}

const previewField = StateField.define<{
  focused: boolean
  decorations: DecorationSet
}>({
  create: (state) => ({
    focused: false,
    decorations: previewDecorations(state, false),
  }),
  update(value, transaction) {
    let focused = value.focused
    for (const effect of transaction.effects) {
      if (effect.is(previewFocus)) focused = effect.value
    }
    if (
      transaction.docChanged ||
      transaction.selection ||
      focused !== value.focused ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    ) {
      return {
        focused,
        decorations: previewDecorations(transaction.state, focused),
      }
    }
    return value
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
})

const formattedAppearance = EditorView.theme({
  '.cm-preview-heading': {
    fontWeight: '650',
    color: 'var(--app-syntax-heading)',
    lineHeight: '1.35',
    paddingTop: '0.45em',
    paddingBottom: '0.2em',
  },
  '.cm-preview-h1': { fontSize: '1.8em' },
  '.cm-preview-h2': { fontSize: '1.5em' },
  '.cm-preview-h3': { fontSize: '1.25em' },
  '.cm-preview-h4': { fontSize: '1.1em' },
  '.cm-preview-h5': { fontSize: '1em' },
  '.cm-preview-h6': { fontSize: '0.95em', color: 'var(--app-text-muted)' },
  '.cm-preview-quote': {
    borderLeft: '3px solid var(--color-primary)',
    paddingLeft: '0.8em',
    color: 'var(--app-syntax-quote)',
    background: 'var(--app-accent-soft)',
  },
  '.cm-preview-list-item': { paddingLeft: '1.25em', textIndent: '-1.25em' },
  '.cm-preview-list-marker': {
    display: 'inline-block',
    minWidth: '1em',
    color: 'var(--app-text-muted)',
    textIndent: '0',
  },
  '.cm-preview-checkbox': {
    accentColor: 'var(--color-primary)',
    verticalAlign: 'middle',
    margin: '0 0.35em 0 0',
  },
  '.cm-preview-inline-code': {
    fontFamily: 'var(--font-mono)',
    background: 'var(--app-surface-raised)',
    borderRadius: '4px',
    padding: '0.1em 0.2em',
  },
  '.cm-preview-code-block': {
    fontFamily: 'var(--font-mono)',
    background: 'var(--app-surface-raised)',
    padding: '0 0.75em',
    textIndent: '0',
  },
  '.cm-preview-widget': { cursor: 'text', maxWidth: '100%' },
  '.cm-preview-table': { overflowX: 'auto', padding: '0.5em 0' },
  '.cm-preview-table table': { borderCollapse: 'collapse', width: '100%' },
  '.cm-preview-table th, .cm-preview-table td': {
    border: '1px solid var(--app-border)',
    padding: '0.4em 0.65em',
  },
  '.cm-preview-table th': {
    background: 'var(--app-surface-raised)',
    fontWeight: '600',
  },
  '.cm-preview-widget p': { margin: '0' },
  '.cm-preview-widget img': { maxWidth: '100%', maxHeight: '24rem' },
  '.cm-preview-image': { display: 'inline-block' },
  '.cm-preview-image-label': {
    color: 'var(--app-text-muted)',
    background: 'var(--app-surface-raised)',
    borderRadius: '4px',
    padding: '0.2em 0.5em',
  },
  '.cm-preview-rule hr': {
    border: 'none',
    borderTop: '1px solid var(--app-border)',
    margin: '1em 0',
  },
})

const sourceAppearance = EditorView.theme({
  '.cm-scroller': { fontFamily: 'var(--font-mono)' },
})

const previewExtensions = (enabled: boolean): Extension =>
  enabled
    ? [
        previewField,
        EditorView.focusChangeEffect.of((_state, focused) =>
          previewFocus.of(focused)
        ),
        formattedAppearance,
        syntaxHighlighting(editorHighlightStyle),
        EditorView.atomicRanges.of((view) =>
          view.state
            .field(previewField)
            .decorations.update({
              filter: (_from, _to, decoration) =>
                decoration.spec.previewAtomic === true,
            })
        ),
      ]
    : sourceAppearance

/** Switches between the formatted look and the raw Markdown source */
export const markdownPreviewCompartment = new Compartment()

export const markdownPreview = (enabled: boolean): Extension =>
  markdownPreviewCompartment.of(previewExtensions(enabled))

export const setMarkdownPreview = (view: EditorView, enabled: boolean) => {
  view.dispatch({
    effects: [
      markdownPreviewCompartment.reconfigure(previewExtensions(enabled)),
      previewFocus.of(view.hasFocus),
    ],
  })
}
