<template>
  <ContentPadding>
    <InsertMenu
      :allow-insert-button="false"
      :text="text"
      :shortcuts-disabled="shortcutsDisabled"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import InsertMenu from '../components/menu/InsertMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'

const { text, shortcutsDisabled } = useSelectionActionContext()
const actionMenuStore = useActionMenuStore()
const desktopStore = useDesktopStore()

onMounted(() => {
  actionMenuStore.setPage(desktopStore.desktopState.actionPageIndex ?? 0)
})
</script>
