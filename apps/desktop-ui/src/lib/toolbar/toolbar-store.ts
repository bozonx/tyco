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
    registeredToolbarItems.value = [...registeredToolbarItems.value, ...items]
  }

  const clearToolbarItems = () => {
    registeredToolbarItems.value = []
  }

  const unregisterPlugin = (id: string) => {
    registeredToolbarItems.value = registeredToolbarItems.value.filter(
      (item) => !item.id?.startsWith(`${id}:`)
    )
  }

  return {
    unregisterPlugin,
    getToolbarItems,
    getLeftToolbarItems,
    getRightToolbarItems,
    registerToolbarItems,
    clearToolbarItems,
  }
}
