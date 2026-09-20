<template>
  <ContentPadding> 
    <InsertMenu 
      :allowInsertButton="false"
      :text="text"
      :stopListening="menuModalsStore.anyModalOpen" />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useIpcStore } from '../stores/ipc';
import { useNavPanelStore } from '../stores/navPanel';
import { useMenuModalsStore } from '../stores/menuModals';

const menuModalsStore = useMenuModalsStore();
const navPanelStore = useNavPanelStore();
const ipcStore = useIpcStore();
const text = computed(() => ipcStore.params?.selectedText || '');

navPanelStore.resetNavParams({});
</script>
