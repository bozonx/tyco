import { inject, provide, type InjectionKey } from 'vue'

import { createMarkupMode } from '../lib/editor/markup-mode'
import { useEditorInputStore } from '../stores/editor-input'

type MarkupMode = ReturnType<typeof createMarkupMode>

const MARKUP_MODE_KEY: InjectionKey<MarkupMode> = Symbol('markup-mode')

/** The Markdown view of one editor page; it starts formatted on every visit */
export function provideMarkupMode(): MarkupMode {
  const mode = createMarkupMode(useEditorInputStore().requestFocus)
  provide(MARKUP_MODE_KEY, mode)
  return mode
}

/** The Markdown view of the editor page around the caller */
export function useMarkupMode(): MarkupMode {
  const mode = inject(MARKUP_MODE_KEY, null)
  if (!mode) throw new Error('useMarkupMode() needs an editor page around it')
  return mode
}
