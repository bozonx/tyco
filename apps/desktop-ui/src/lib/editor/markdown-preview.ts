import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import { Compartment } from '@codemirror/state'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'

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
  to = state.doc.length
): HiddenRange[] => {
  const active = activeLines(state)
  const ranges: HiddenRange[] = []
  const hide = (start: number, end: number) => {
    if (end <= start) return
    if (start <= active.to && end >= active.from) return
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

const hiddenMark = Decoration.replace({})

const buildDecorations = (view: EditorView): DecorationSet => {
  const decorations: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    for (const range of hiddenMarkup(view.state, from, to)) {
      decorations.push(hiddenMark.range(range.from, range.to))
    }
  }

  return Decoration.set(decorations, true)
}

const markdownPreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // the caret jumps over a hidden mark as over a single character
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none
      ),
  }
)

/** Switches between the formatted look and the raw Markdown source */
export const markdownPreviewCompartment = new Compartment()

export const markdownPreview = (enabled: boolean): Extension =>
  markdownPreviewCompartment.of(enabled ? markdownPreviewPlugin : [])

export const setMarkdownPreview = (view: EditorView, enabled: boolean) => {
  view.dispatch({
    effects: markdownPreviewCompartment.reconfigure(
      enabled ? markdownPreviewPlugin : []
    ),
  })
}
