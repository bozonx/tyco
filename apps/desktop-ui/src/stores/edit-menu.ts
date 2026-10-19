import { defineStore } from 'pinia'

import { formatMarkdown } from '../lib/editor/format-markdown'
import { useDesktopStore } from './desktop'
import { transformTextCase } from '../lib/edit-menu/text-edit'
import {
  type EditItem,
  createEditMenuModel,
} from '../lib/edit-menu/edit-menu-model'
import { stripMarkdown } from '../lib/editor/strip-markdown'

export type { EditItem }

export const useEditMenuStore = defineStore('editMenu', () => {
  const desktopStore = useDesktopStore()

  return createEditMenuModel({
    transformTextCase,
    formatMdAndStyle: async (text) =>
      formatMarkdown(text, desktopStore.userConfig?.markdown.format),
    stripMarkdown: (text) =>
      stripMarkdown(text, desktopStore.userConfig?.markdown.strip),
  })
})
