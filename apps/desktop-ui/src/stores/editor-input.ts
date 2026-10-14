import { defineStore } from 'pinia'

import { createEditorInputModel } from '../lib/editor-input/editor-input-model'

export const useEditorInputStore = defineStore(
  'editorInput',
  createEditorInputModel
)
