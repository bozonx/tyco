import type { StylingConfig, StylingsConfig } from '@tyco/shared'

import {
  cloneSlotLibrary,
  findSlotItem,
  moveSlotItem,
  placeNewSlotItem,
  removeSlotItemAt,
  slotItemList,
  updateSlotItem,
  withoutEmptySlotItems,
} from '../shortcut-slots/slot-library'

/** The text styles and the menu that shows them, `styling` of the config */
export type StylingLibrary = StylingsConfig

type Item = StylingConfig
type Library = StylingLibrary

export const cloneStylingLibrary = (library: Library) =>
  cloneSlotLibrary<Item, Library>(library)
export const findStyling = findSlotItem<Item>
export const stylingSlotList = slotItemList<Item>
export const placeNewStyling = (library: Library, index: number, item: Item) =>
  placeNewSlotItem<Item, Library>(library, index, item)
export const removeStylingAt = (library: Library, index: number) =>
  removeSlotItemAt<Item, Library>(library, index)
export const moveStylingSlot = (library: Library, from: number, to: number) =>
  moveSlotItem<Item, Library>(library, from, to)
export const updateStyling = (
  library: Library,
  stylingId: string,
  patch: Partial<Omit<Item, 'id'>>
) => updateSlotItem<Item, Library>(library, stylingId, patch)
export const withoutEmptyStylings = (library: Library) =>
  withoutEmptySlotItems<Item, Library>(library)
