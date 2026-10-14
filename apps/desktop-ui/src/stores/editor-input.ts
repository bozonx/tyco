import { defineStore } from 'pinia'

import { createEditorInputModel } from '../lib/editor-input/editor-input-store'

export const useEditorInputStore = defineStore(
  'editorInput',
  createEditorInputModel
)
