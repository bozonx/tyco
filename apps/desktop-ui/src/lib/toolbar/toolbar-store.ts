import { shallowRef } from 'vue'

import type { ToolbarItem } from '../../types/plugins'

export function createToolbarStoreModel() {
  const registeredToolbarItems = shallowRef<ToolbarItem[]>([])

  const getToolbarItems = (): ToolbarItem[] => {
    return [...registeredToolbarItems.value]
  }

  const getLeftToolbarItems = (): ToolbarItem[] => {
    return registeredToolbarItems.value.filter(
      (item) => item.position === 'left'
    )
  }

  const getRightToolbarItems = (): ToolbarItem[] => {
    return registeredToolbarItems.value.filter(
      (item) => item.position !== 'left'
    )
  }

  const registerToolbarItems = (items: ToolbarItem[]) => {
    registeredToolbarItems.value.push(...items)
  }

  const clearToolbarItems = () => {
    registeredToolbarItems.value = []
  }

  return {
    getToolbarItems,
    getLeftToolbarItems,
    getRightToolbarItems,
    registerToolbarItems,
    clearToolbarItems,
  }
}
