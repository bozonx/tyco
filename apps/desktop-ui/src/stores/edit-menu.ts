import { defineStore } from 'pinia'

import { formatMarkdown } from '../lib/editor/format-markdown'
import { useIpcStore } from './ipc'
import { transformTextCase } from '../lib/edit-menu/text-edit'
import {
  type EditItem,
  createEditMenuModel,
} from '../lib/edit-menu/edit-menu-store'
import { stripMarkdown } from '../lib/editor/strip-markdown'

export type { EditItem }

export const useEditMenuStore = defineStore('editMenu', () => {
  const ipcStore = useIpcStore()

  return createEditMenuModel({
    transformTextCase,
    formatMdAndStyle: async (text) =>
      formatMarkdown(text, ipcStore.desktopState?.userConfig?.markdown),
    stripMarkdown: (text) =>
      stripMarkdown(text, ipcStore.desktopState?.userConfig?.markdownClean),
  })
})
