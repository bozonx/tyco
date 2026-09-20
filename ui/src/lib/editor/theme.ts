import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * Тема редактора. Все цвета — CSS-переменные приложения, поэтому светлая и
 * тёмная темы переключаются сменой `data-theme` на `<html>`, без пересоздания
 * редактора
 */
export const editorTheme: Extension = EditorView.theme({
  '&': {
    height: '100%',
    width: '100%',
    color: 'inherit',
    backgroundColor: 'transparent',
    fontFamily: 'var(--editor-font-family)',
    fontSize: 'var(--editor-font-size)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    // «писательский» вид: пропорциональный шрифт и крупный интерлиньяж,
    // а не моноширинный вид редактора кода
    fontFamily: 'var(--editor-font-family)',
    fontSize: 'var(--editor-font-size)',
    lineHeight: 'var(--editor-line-height)',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: 'var(--editor-padding)',
    caretColor: 'oklch(var(--p))',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-placeholder': {
    color: 'var(--app-text-faint)',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'oklch(var(--p))',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection':
    {
      backgroundColor: 'var(--editor-selection-bg)',
    },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
})

/**
 * Подсветка Markdown и вложенных блоков кода. Цвета — те же CSS-переменные,
 * так что тема не дублируется для светлой и тёмной
 */
export const editorHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading,
    color: 'var(--app-syntax-heading)',
    fontWeight: '600',
  },
  { tag: tags.heading1, fontSize: '1.35em', lineHeight: '1.3' },
  { tag: tags.heading2, fontSize: '1.2em', lineHeight: '1.35' },
  { tag: tags.heading3, fontSize: '1.1em' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--app-syntax-link)' },
  { tag: tags.url, color: 'var(--app-syntax-link)' },
  { tag: tags.quote, color: 'var(--app-syntax-quote)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--app-syntax-meta)' },
  { tag: tags.meta, color: 'var(--app-syntax-meta)' },
  { tag: tags.processingInstruction, color: 'var(--app-syntax-meta)' },
  {
    tag: tags.monospace,
    fontFamily: 'var(--font-mono)',
    color: 'var(--app-syntax-code)',
  },
  { tag: tags.keyword, color: 'var(--app-syntax-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--app-syntax-keyword)' },
  { tag: tags.definitionKeyword, color: 'var(--app-syntax-keyword)' },
  { tag: tags.string, color: 'var(--app-syntax-string)' },
  { tag: tags.number, color: 'var(--app-syntax-number)' },
  { tag: tags.bool, color: 'var(--app-syntax-number)' },
  { tag: tags.comment, color: 'var(--app-syntax-comment)', fontStyle: 'italic' },
  { tag: tags.function(tags.variableName), color: 'var(--app-syntax-link)' },
  { tag: tags.typeName, color: 'var(--app-syntax-heading)' },
  { tag: tags.propertyName, color: 'var(--app-syntax-code)' },
  { tag: tags.invalid, color: 'oklch(var(--er))' },
])

/** Тема + подсветка одним расширением */
export const editorAppearance: Extension = [
  editorTheme,
  syntaxHighlighting(editorHighlightStyle),
]
