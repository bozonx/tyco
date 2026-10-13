import { defineStore } from 'pinia'

import { createEditorInputStoreModel } from '../lib/editor-input/editor-input-store'

export const useEditorInputStore = defineStore(
  'editorInput',
  createEditorInputStoreModel
)
