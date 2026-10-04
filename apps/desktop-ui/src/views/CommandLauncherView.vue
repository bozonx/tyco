<template>
  <ContentPadding>
    <CommandLauncher :stopListening="stopListening" />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import CommandLauncher from '../components/menu/CommandLauncher.vue'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'

const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const navPanelStore = useNavPanelStore()

// The view outlives a hidden window. Until the next activation reaches it, the
// keys belong to whatever mode that activation opens
const stopListening = computed(
  () => menuModalsStore.anyModalOpen || !ipcStore.params.isWindowShown
)

navPanelStore.resetNavParams({})
</script>
