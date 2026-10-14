import { defineStore } from 'pinia'

import { createMarkupMode } from '../lib/editor/markup-mode'
import { useEditorInputStore } from './editor-input'

export const useMarkupModeStore = defineStore('markupMode', () => {
  const editor = useEditorInputStore()
  return createMarkupMode(editor.requestFocus)
})
