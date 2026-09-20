import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useCodeFormatter } from '../composables/useCodeFormatter'
import { useTextTransform } from '../composables/useTextTransform'

export interface EditItem {
  name?: string
  labelKey?: string
  icon?: string
  action: (text: string) => Promise<string>
}

export const useEditMenuStore = defineStore('editMenu', () => {
  const { doCaseTransform } = useTextTransform()
  const { formatMdAndStyle, formatSomeCode } = useCodeFormatter()

  const registeredEditMenu = ref<EditItem[]>([])

  const getEditMenu = () => {
    const defaultEditItems: EditItem[] = [
      {
        labelKey: 'edit.beautifyMd',
        action: async (text: string) => formatMdAndStyle(text),
      },
      {
        labelKey: 'edit.formatCode',
        action: async (text: string) => formatSomeCode(text),
      },
      {
        labelKey: 'edit.normalize',
        action: async (text: string) => doCaseTransform(text, 'normalize'),
      },
      {
        labelKey: 'edit.uppercase',
        action: async (text: string) => doCaseTransform(text, 'uppercase'),
      },
      {
        labelKey: 'edit.lowercase',
        action: async (text: string) => doCaseTransform(text, 'lowercase'),
      },
      {
        labelKey: 'edit.camelCase',
        action: async (text: string) => doCaseTransform(text, 'camelCase'),
      },
      {
        labelKey: 'edit.pascalCase',
        action: async (text: string) => doCaseTransform(text, 'pascalCase'),
      },
      {
        labelKey: 'edit.snakeCase',
        action: async (text: string) => doCaseTransform(text, 'snakeCase'),
      },
      {
        labelKey: 'edit.kebabCase',
        action: async (text: string) => doCaseTransform(text, 'kebabCase'),
      },
    ]

    return [...defaultEditItems, ...registeredEditMenu.value]
  }

  const registerEditItems = (edit: EditItem[]) => {
    registeredEditMenu.value.push(...edit)
  }

  return {
    getEditMenu,
    registerEditItems,
  }
})
