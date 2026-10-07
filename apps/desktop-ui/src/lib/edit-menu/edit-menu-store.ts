import { shallowRef } from 'vue'

export interface EditItem {
  id?: string
  name?: string
  labelKey?: string
  label?: string
  icon?: string
  selectionOnly?: boolean
  action: (text: string) => Promise<string> | string
}

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
    registeredCaseMenu.value.push(...items)
  }

  const registerFormatItems = (items: EditItem[]) => {
    registeredFormatMenu.value.push(...items)
  }

  const registerEditItems = (items: EditItem[]) => {
    registeredOtherEditMenu.value.push(...items)
  }

  const clearRegisteredItems = () => {
    registeredCaseMenu.value = []
    registeredFormatMenu.value = []
    registeredOtherEditMenu.value = []
  }

  return {
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
