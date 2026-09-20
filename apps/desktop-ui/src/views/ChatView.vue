<template>
  <div class="flex flex-row h-full overflow-hidden">
    <ChatSidebar />
    <div class="flex-1 overflow-hidden h-full">
      <ContentPadding class="h-full">
        <AiChat />
      </ContentPadding>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import AiChat from '../components/AiChat.vue'
import ChatSidebar from '../components/chat/ChatSidebar.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import { useHistoryStore } from '../stores/history'
import { useNavPanelStore } from '../stores/navPanel'

const navPanelStore = useNavPanelStore()
const historyStore = useHistoryStore()

navPanelStore.resetNavParams({})

onMounted(async () => {
  await historyStore.loadChatHistory()
})
</script>
