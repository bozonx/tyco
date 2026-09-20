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
  import { onMounted } from "vue";
  import { useNavPanelStore } from "../stores/navPanel";
  import { useHistoryStore } from "../stores/history";
  import ChatSidebar from "../components/chat/ChatSidebar.vue";
  import AiChat from "../components/AiChat.vue";
  import ContentPadding from "../components/common/ContentPadding.vue";

  const navPanelStore = useNavPanelStore();
  const historyStore = useHistoryStore();

  navPanelStore.resetNavParams({});

  onMounted(async () => {
    await historyStore.loadChatHistory();
  });
</script>