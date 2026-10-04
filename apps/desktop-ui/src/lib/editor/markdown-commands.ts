import { EditorSelection } from '@codemirror/state'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'

/** Inline markup put around the selection */
export type InlineMark = '**' | '*' | '~~' | '`'

/** Markup at the start of each selected line */
export type LinePrefix = '# ' | '## ' | '### ' | '- ' | '1. ' | '> '

const LINE_PREFIX = /^(#{1,6} |[-*+] |\d+[.)] |> )/

/**
 * Wraps the selection in `mark`, or unwraps it when the mark is already around
 * it (inside or just outside the selection). An empty selection gets an empty
 * pair with the caret between the marks.
 */
export const toggleInlineMark = (
  state: EditorState,
  mark: InlineMark
): TransactionSpec => {
  const { from, to } = state.selection.main
  const size = mark.length
  const text = state.sliceDoc(from, to)

  if (text.length >= size * 2 && text.startsWith(mark) && text.endsWith(mark)) {
    const inner = text.slice(size, -size)
    return {
      changes: { from, to, insert: inner },
      selection: EditorSelection.range(from, from + inner.length),
    }
  }

  const before = state.sliceDoc(from - size, from)
  const after = state.sliceDoc(to, to + size)

  if (from !== to && before === mark && after === mark) {
    return {
      changes: [
        { from: from - size, to: from, insert: '' },
        { from: to, to: to + size, insert: '' },
      ],
      selection: EditorSelection.range(from - size, to - size),
    }
  }

  return {
    changes: [
      { from, insert: mark },
      { from: to, insert: mark },
    ],
    selection: EditorSelection.range(from + size, to + size),
  }
}

/**
 * Sets `prefix` on every line of the selection, replacing a heading, list or
 * quote prefix already there; when all the lines have it, removes it.
 */
export const toggleLinePrefix = (
  state: EditorState,
  prefix: LinePrefix
): TransactionSpec => {
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to).number
  const lines = Array.from({ length: last - first + 1 }, (_, index) =>
    state.doc.line(first + index)
  )
  const hasPrefix = (text: string) =>
    prefix === '1. ' ? /^\d+[.)] /.test(text) : text.startsWith(prefix)
  const remove = lines.every((line) => hasPrefix(line.text))

  const changes = lines.map((line, index) => {
    const current = line.text.match(LINE_PREFIX)?.[0] ?? ''
    const next = remove ? '' : prefix === '1. ' ? `${index + 1}. ` : prefix

    return { from: line.from, to: line.from + current.length, insert: next }
  })

  return { changes }
}

/**
 * `[text](url)` from the selection; the caret lands where the address goes. A
 * selection that is an address itself becomes the address.
 */
export const insertLink = (state: EditorState): TransactionSpec => {
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)

  if (/^https?:\/\/\S+$/.test(text)) {
    return {
      changes: { from, to, insert: `[](${text})` },
      selection: EditorSelection.cursor(from + 1),
    }
  }

  const insert = `[${text}]()`

  return {
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length - 1),
  }
}

const run =
  (spec: (state: EditorState) => TransactionSpec) =>
  (view: EditorView): boolean => {
    view.dispatch(
      view.state.update(spec(view.state), {
        scrollIntoView: true,
        userEvent: 'input.format',
      })
    )
    return true
  }

export const markdownCommands = {
  bold: run((state) => toggleInlineMark(state, '**')),
  italic: run((state) => toggleInlineMark(state, '*')),
  strikethrough: run((state) => toggleInlineMark(state, '~~')),
  code: run((state) => toggleInlineMark(state, '`')),
  link: run(insertLink),
  heading1: run((state) => toggleLinePrefix(state, '# ')),
  heading2: run((state) => toggleLinePrefix(state, '## ')),
  heading3: run((state) => toggleLinePrefix(state, '### ')),
  bulletList: run((state) => toggleLinePrefix(state, '- ')),
  orderedList: run((state) => toggleLinePrefix(state, '1. ')),
  quote: run((state) => toggleLinePrefix(state, '> ')),
}

export type MarkdownCommand = keyof typeof markdownCommands

/** The usual shortcuts of text editors; there is no toolbar for them */
export const markdownKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: markdownCommands.bold },
  { key: 'Mod-i', run: markdownCommands.italic },
  { key: 'Mod-k', run: markdownCommands.link },
  { key: 'Mod-e', run: markdownCommands.code },
  { key: 'Mod-Shift-x', run: markdownCommands.strikethrough },
]
