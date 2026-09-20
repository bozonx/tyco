<template>
  <div role="tablist" class="tabs tabs-border">
    <TabItem
      v-for="tab in tabs"
      :key="tab.key"
      :active="tab.key === activeTab"
      @click="onTabClick(tab.key)"
    >
      {{ tab.text }}
    </TabItem>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import TabItem from './TabItem.vue'

const emit = defineEmits<{
  (e: 'update:value', key: string | number): void
}>()

const props = defineProps<{
  tabs: {
    text: string
    key: string | number
  }[]
  value?: string | number
}>()

const activeTab = computed(() => props.value ?? props.tabs[0]?.key ?? '')

const onTabClick = (key: string | number) => {
  emit('update:value', key)
}
</script>
