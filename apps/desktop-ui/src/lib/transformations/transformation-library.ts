import type { TransformationConfig, TransformationsConfig } from '@tyco/shared'

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

/**
 * The text transformations and the menu that shows them, `transformations` of
 * the config
 */
export type TransformationLibrary = TransformationsConfig

type Item = TransformationConfig
type Library = TransformationLibrary

export const cloneTransformationLibrary = (library: Library) =>
  cloneSlotLibrary<Item, Library>(library)
export const findTransformation = findSlotItem<Item>
export const transformationSlotList = slotItemList<Item>
export const placeNewTransformation = (
  library: Library,
  index: number,
  item: Item
) => placeNewSlotItem<Item, Library>(library, index, item)
export const removeTransformationAt = (library: Library, index: number) =>
  removeSlotItemAt<Item, Library>(library, index)
export const moveTransformationSlot = (
  library: Library,
  from: number,
  to: number
) => moveSlotItem<Item, Library>(library, from, to)
export const updateTransformation = (
  library: Library,
  transformationId: string,
  patch: Partial<Omit<Item, 'id'>>
) => updateSlotItem<Item, Library>(library, transformationId, patch)
export const withoutEmptyTransformations = (library: Library) =>
  withoutEmptySlotItems<Item, Library>(library)
