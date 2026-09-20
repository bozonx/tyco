import { shallowRef } from 'vue'

export interface EditItem {
  id?: string
  name?: string
  labelKey?: string
  label?: string
  icon?: string
  action: (text: string) => Promise<string> | string
}

export interface EditMenuDependencies {
  doCaseTransform: (text: string, caseType: string) => string
  formatMdAndStyle: (text: string) => Promise<string>
  formatSomeCode: (text: string) => Promise<string>
}

export function createEditMenuStoreModel(deps: EditMenuDependencies) {
  const registeredCaseMenu = shallowRef<EditItem[]>([])
  const registeredFormatMenu = shallowRef<EditItem[]>([])
  const registeredOtherEditMenu = shallowRef<EditItem[]>([])

  const getDefaultCaseItems = (): EditItem[] => [
    {
      id: 'case-normalize',
      labelKey: 'edit.normalize',
      action: async (text: string) => deps.doCaseTransform(text, 'normalize'),
    },
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
    {
      id: 'case-camelCase',
      labelKey: 'edit.camelCase',
      action: async (text: string) => deps.doCaseTransform(text, 'camelCase'),
    },
    {
      id: 'case-pascalCase',
      labelKey: 'edit.pascalCase',
      action: async (text: string) => deps.doCaseTransform(text, 'pascalCase'),
    },
    {
      id: 'case-snakeCase',
      labelKey: 'edit.snakeCase',
      action: async (text: string) => deps.doCaseTransform(text, 'snakeCase'),
    },
    {
      id: 'case-kebabCase',
      labelKey: 'edit.kebabCase',
      action: async (text: string) => deps.doCaseTransform(text, 'kebabCase'),
    },
  ]

  const getDefaultFormatItems = (): EditItem[] => [
    {
      id: 'format-beautifyMd',
      labelKey: 'edit.beautifyMd',
      action: async (text: string) => deps.formatMdAndStyle(text),
    },
    {
      id: 'format-formatCode',
      labelKey: 'edit.formatCode',
      action: async (text: string) => deps.formatSomeCode(text),
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
