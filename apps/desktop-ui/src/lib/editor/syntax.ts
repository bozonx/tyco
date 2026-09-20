import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import type { EditorSyntax } from '@tyco/shared'

/** Режим подсветки меняется настройкой, без пересоздания редактора */
export const syntaxCompartment = new Compartment()

/**
 * Расширение подсветки для режима документа. В режиме `markdown` вложенные
 * fenced-блоки подсвечиваются по указанному языку — отдельный «режим кода» не
 * нужен
 */
export const syntaxExtension = (mode: EditorSyntax): Extension =>
  mode === 'markdown'
    ? markdown({ base: markdownLanguage, codeLanguages: languages })
    : []
