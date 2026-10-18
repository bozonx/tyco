<template>
  <ContentPadding>
    <CommandLauncher :shortcutsDisabled="shortcutsDisabled" />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import CommandLauncher from '../components/menu/CommandLauncher.vue'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'

const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()

// The view outlives a hidden window. Until the next activation reaches it, the
// keys belong to whatever mode that activation opens
const shortcutsDisabled = computed(
  () => menuModalsStore.hasOpenModal || !ipcStore.desktopState.isWindowShown
)
</script>
