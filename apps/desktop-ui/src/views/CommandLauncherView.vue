<template>
  <ContentPadding>
    <CommandLauncher :shortcuts-disabled="shortcutsDisabled" />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import CommandLauncher from '../components/menu/CommandLauncher.vue'
import { useDesktopStore } from '../stores/desktop'
import { useMenuModalsStore } from '../stores/menu-modals'

const desktopStore = useDesktopStore()
const menuModalsStore = useMenuModalsStore()

// The view outlives a hidden window. Until the next activation reaches it, the
// keys belong to whatever mode that activation opens
const shortcutsDisabled = computed(
  () => menuModalsStore.hasOpenModal || !desktopStore.desktopState.isWindowShown
)
</script>
