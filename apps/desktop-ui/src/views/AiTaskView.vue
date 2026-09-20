<template>
  <ContentPadding>
    <AiTaskMenu 
      :text="text"
      :stopListening="menuModalsStore.anyModalOpen" />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useIpcStore } from '../stores/ipc';
import { useMenuModalsStore } from '../stores/menuModals';
import { useNavPanelStore } from '../stores/navPanel';

const ipcStore = useIpcStore();
const menuModalsStore = useMenuModalsStore();
const navPanelStore = useNavPanelStore();
const text = computed(() => ipcStore.params?.selectedText || '');

navPanelStore.resetNavParams({});
</script>
