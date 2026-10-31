<template>
  <RuleLibraryMenu
    :kind="kind"
    :text="props.text"
    :shortcuts-disabled="props.shortcutsDisabled"
    :item-id="props.transformationId"
  />
</template>

<script setup lang="ts">
import type { TransformationMenuParams } from '../../lib/modals/menu-modal-params'
import type { RuleLibraryMenuKind } from '../../lib/modals/rule-library-menu'
import { addTransformationFromPrompt } from '../../lib/transformations/transformation-prompt'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import RuleLibraryMenu from './RuleLibraryMenu.vue'
import { APP_CONFIG } from '@tyco/shared'

const props = withDefaults(defineProps<TransformationMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  transformationId: undefined,
})

const menuModalsStore = useMenuModalsStore()

const kind: RuleLibraryMenuKind = {
  titleKey: 'menu.transformation',
  toolId: 'core.transformation',
  minTextLength: APP_CONFIG.minTransformationLength,
  pending: { transformation: true },
  getLibrary: (config) => config?.transformations,
  patchLibrary: (library) => ({ transformations: library }),
  savePrompt: addTransformationFromPrompt,
  clearStartupItem: (stepId) =>
    menuModalsStore.updateStep(stepId, MenuModals.TRANSFORMATION, {
      transformationId: undefined,
    }),
}
</script>
