import { defineStore } from 'pinia'

import { formatMarkdown } from '../lib/editor/format-markdown'
import { useIpcStore } from './ipc'
import { useTextTransform } from '../composables/useTextTransform'
import {
  type EditItem,
  createEditMenuStoreModel,
} from '../lib/edit-menu/edit-menu-store'
import { stripMarkdown } from '../lib/editor/strip-markdown'

export type { EditItem }

export const useEditMenuStore = defineStore('editMenu', () => {
  const { doCaseTransform } = useTextTransform()
  const ipcStore = useIpcStore()

  return createEditMenuStoreModel({
    doCaseTransform,
    formatMdAndStyle: async (text) =>
      formatMarkdown(text, ipcStore.params?.userConfig?.markdown),
    stripMarkdown: (text) =>
      stripMarkdown(text, ipcStore.params?.userConfig?.markdownClean),
  })
})
