import { EditorSelection } from '@codemirror/state'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'

/** Inline markup put around the selection */
export type InlineMark = '**' | '*' | '~~' | '`'

/** Markup at the start of each selected line */
export type LinePrefix = '# ' | '## ' | '### ' | '- ' | '1. ' | '- [ ] ' | '> '

/** Indentation, then the block markup of a line: a task before a plain bullet */
const LINE_PREFIX = /^([ \t]*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )?/

/** Whether `current` markup is the kind of block `prefix` makes */
const isSameKind = (current: string, prefix: LinePrefix): boolean => {
  switch (prefix) {
    case '- ':
      return /^[-*+] $/.test(current)
    case '1. ':
      return /^\d+[.)] $/.test(current)
    case '- [ ] ':
      return /^[-*+] \[[ xX]\] $/.test(current)
    default:
      return current === prefix
  }
}

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
  // A pair of stars is strong emphasis, not two independent italic markers.
  const canRemove = (left: string, right: string): boolean => {
    if (mark !== '*') return left.endsWith(mark) && right.startsWith(mark)
    const leftCount = left.match(/\*+$/)?.[0].length ?? 0
    const rightCount = right.match(/^\*+/)?.[0].length ?? 0
    return leftCount % 2 === 1 && rightCount % 2 === 1
  }

  if (
    text.length >= size * 2 &&
    text.startsWith(mark) &&
    text.endsWith(mark) &&
    (mark !== '*' ||
      canRemove(text.match(/^\*+/)?.[0] ?? '', text.match(/\*+$/)?.[0] ?? ''))
  ) {
    const inner = text.slice(size, -size)
    return {
      changes: { from, to, insert: inner },
      selection: EditorSelection.range(from, from + inner.length),
    }
  }

  const before = state.sliceDoc(0, from)
  const after = state.sliceDoc(to)

  if (from !== to && canRemove(before, after)) {
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
  const last = state.doc.lineAt(
    to > from && state.doc.lineAt(to).from === to ? to - 1 : to
  ).number
  const lines = Array.from({ length: last - first + 1 }, (_, index) =>
    state.doc.line(first + index)
  )
  const parsed = lines.map((line) => {
    const [, indent = '', current = ''] = LINE_PREFIX.exec(line.text) ?? []
    return { line, indent, current }
  })
  const remove = parsed.every(({ current }) => isSameKind(current, prefix))

  // nested items keep their indentation; only the markup after it changes
  const changes = parsed.map(({ line, indent, current }, index) => {
    const next = remove ? '' : prefix === '1. ' ? `${index + 1}. ` : prefix
    const from = line.from + indent.length

    return { from, to: from + current.length, insert: next }
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
  taskList: run((state) => toggleLinePrefix(state, '- [ ] ')),
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
