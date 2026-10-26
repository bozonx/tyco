import { onBeforeUnmount, watch } from 'vue'

import {
  createDismissibleLayerStack,
  type DismissibleLayer,
} from '../lib/modals/dismissible-layer-stack'

const defaultStack = createDismissibleLayerStack()

export const isWithinDismissibleLayer = defaultStack.isWithinDismissibleLayer
export const clearDismissibleLayers = defaultStack.clear
export const resetDismissibleKeyboardState = defaultStack.resetKeyboardState

/**
 * Only the top open layer handles outside interaction and global keyboard
 * events.
 */
export function useDismissibleLayer(layer: DismissibleLayer) {
  const remove = () => defaultStack.remove(layer)
  watch(
    layer.isOpen,
    (open) => {
      defaultStack.sync(layer, open)
    },
    { immediate: true, flush: 'sync' }
  )
  onBeforeUnmount(remove)
}
