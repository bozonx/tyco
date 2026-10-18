import { ref } from 'vue'

export function createChatLayoutModel() {
  const isSidebarOpen = ref(true)

  function openSidebar() {
    isSidebarOpen.value = true
  }

  function closeSidebar() {
    isSidebarOpen.value = false
  }

  return { isSidebarOpen, openSidebar, closeSidebar }
}
