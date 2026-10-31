<template>
  <RuleLibraryMenu
    :kind="kind"
    :text="props.text"
    :shortcuts-disabled="props.shortcutsDisabled"
    :item-id="props.stylingId"
  />
</template>

<script setup lang="ts">
import type { StylingMenuParams } from '../../lib/modals/menu-modal-params'
import type { RuleLibraryMenuKind } from '../../lib/modals/rule-library-menu'
import { addStylingFromPrompt } from '../../lib/styling/styling-prompt'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import RuleLibraryMenu from './RuleLibraryMenu.vue'
import { APP_CONFIG } from '@tyco/shared'

const props = withDefaults(defineProps<StylingMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  stylingId: undefined,
})

const menuModalsStore = useMenuModalsStore()

const kind: RuleLibraryMenuKind = {
  titleKey: 'menu.styling',
  toolId: 'core.styling',
  minTextLength: APP_CONFIG.minStylingLength,
  pending: { styling: true },
  getLibrary: (config) => config?.styling,
  patchLibrary: (library) => ({ styling: library }),
  savePrompt: addStylingFromPrompt,
  clearStartupItem: (stepId) =>
    menuModalsStore.updateStep(stepId, MenuModals.STYLING, {
      stylingId: undefined,
    }),
}
</script>
