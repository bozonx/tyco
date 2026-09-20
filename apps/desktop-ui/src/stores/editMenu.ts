import { defineStore } from 'pinia'

import { useCodeFormatter } from '../composables/useCodeFormatter'
import { useTextTransform } from '../composables/useTextTransform'
import {
  type EditItem,
  createEditMenuStoreModel,
} from '../lib/edit-menu/edit-menu-store'

export type { EditItem }

export const useEditMenuStore = defineStore('editMenu', () => {
  const { doCaseTransform } = useTextTransform()
  const { formatMdAndStyle, formatSomeCode } = useCodeFormatter()

  return createEditMenuStoreModel({
    doCaseTransform,
    formatMdAndStyle,
    formatSomeCode,
  })
})
