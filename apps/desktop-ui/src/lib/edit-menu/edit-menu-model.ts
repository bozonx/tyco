import type { EditItem } from '../../types/plugins'
import { createContributionRegistry } from '../plugins/contribution-registry'

export type { EditItem } from '../../types/plugins'
export interface EditMenuDependencies {
  transformTextCase: (text: string, caseType: string) => string
  formatMdAndStyle: (text: string) => Promise<string>
  stripMarkdown: (text: string) => string
}

export function createEditMenuModel(deps: EditMenuDependencies) {
  const cases = createContributionRegistry<EditItem>()
  const registeredCaseMenu = cases.items
  const formats = createContributionRegistry<EditItem>()
  const registeredFormatMenu = formats.items
  const others = createContributionRegistry<EditItem>()
  const registeredOtherEditMenu = others.items

  const getDefaultCaseItems = (): EditItem[] => [
    {
      id: 'case-uppercase',
      labelKey: 'edit.uppercase',
      action: async (text: string) => deps.transformTextCase(text, 'uppercase'),
    },
    {
      id: 'case-lowercase',
      labelKey: 'edit.lowercase',
      action: async (text: string) => deps.transformTextCase(text, 'lowercase'),
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
    return [...getDefaultCaseItems(), ...cases.list()]
  }

  const getFormatItems = (): EditItem[] => {
    return [...getDefaultFormatItems(), ...formats.list()]
  }

  const getOtherEditItems = (): EditItem[] => {
    return [...others.list()]
  }

  const getEditMenu = (): EditItem[] => {
    return [...getFormatItems(), ...getCaseItems(), ...getOtherEditItems()]
  }

  const registerCaseItems = cases.register
  const registerFormatItems = formats.register
  const registerEditItems = others.register
  const unregisterPlugin = (id: string) => {
    cases.unregisterPlugin(id)
    formats.unregisterPlugin(id)
    others.unregisterPlugin(id)
  }

  return {
    registeredCaseMenu,
    registeredFormatMenu,
    registeredOtherEditMenu,
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
  }
}
