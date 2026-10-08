import type { EditItem } from '@tyco/plugin-sdk'
import { shallowRef } from 'vue'

export type { EditItem } from '@tyco/plugin-sdk'
export interface EditMenuDependencies {
  doCaseTransform: (text: string, caseType: string) => string
  formatMdAndStyle: (text: string) => Promise<string>
  stripMarkdown: (text: string) => string
}

export function createEditMenuStoreModel(deps: EditMenuDependencies) {
  const registeredCaseMenu = shallowRef<EditItem[]>([])
  const registeredFormatMenu = shallowRef<EditItem[]>([])
  const registeredOtherEditMenu = shallowRef<EditItem[]>([])

  const getDefaultCaseItems = (): EditItem[] => [
    {
      id: 'case-uppercase',
      labelKey: 'edit.uppercase',
      action: async (text: string) => deps.doCaseTransform(text, 'uppercase'),
    },
    {
      id: 'case-lowercase',
      labelKey: 'edit.lowercase',
      action: async (text: string) => deps.doCaseTransform(text, 'lowercase'),
    },
  ]

  const getDefaultFormatItems = (): EditItem[] => [
    {
      id: 'format-stripMarkdown',
      labelKey: 'edit.stripMarkdown',
      icon: 'mdi:format-clear',
      action: async (text: string) => deps.stripMarkdown(text),
    },
    {
      id: 'format-beautifyMd',
      labelKey: 'edit.beautifyMd',
      action: async (text: string) => deps.formatMdAndStyle(text),
    },
  ]

  const getCaseItems = (): EditItem[] => {
    return [...getDefaultCaseItems(), ...registeredCaseMenu.value]
  }

  const getFormatItems = (): EditItem[] => {
    return [...getDefaultFormatItems(), ...registeredFormatMenu.value]
  }

  const getOtherEditItems = (): EditItem[] => {
    return [...registeredOtherEditMenu.value]
  }

  const getEditMenu = (): EditItem[] => {
    return [...getFormatItems(), ...getCaseItems(), ...getOtherEditItems()]
  }

  const registerCaseItems = (items: EditItem[]) => {
    registeredCaseMenu.value = [...registeredCaseMenu.value, ...items]
  }

  const registerFormatItems = (items: EditItem[]) => {
    registeredFormatMenu.value = [...registeredFormatMenu.value, ...items]
  }

  const registerEditItems = (items: EditItem[]) => {
    registeredOtherEditMenu.value = [...registeredOtherEditMenu.value, ...items]
  }

  const clearRegisteredItems = () => {
    registeredCaseMenu.value = []
    registeredFormatMenu.value = []
    registeredOtherEditMenu.value = []
  }

  const unregisterPlugin = (id: string) => {
    const keep = (item: EditItem) => !item.id?.startsWith(`${id}:`)
    registeredCaseMenu.value = registeredCaseMenu.value.filter(keep)
    registeredFormatMenu.value = registeredFormatMenu.value.filter(keep)
    registeredOtherEditMenu.value = registeredOtherEditMenu.value.filter(keep)
  }

  return {
    unregisterPlugin,
    getDefaultCaseItems,
    getDefaultFormatItems,
    getCaseItems,
    getFormatItems,
    getOtherEditItems,
    getEditMenu,
    registerCaseItems,
    registerFormatItems,
    registerEditItems,
    clearRegisteredItems,
  }
}
