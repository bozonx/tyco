<template>
  <div class="settings-stack">
    <SettingsEditorHistorySection />
    <SettingsChatHistorySection scope="askAi" />
  </div>
</template>

<script setup lang="ts">
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'
import SettingsEditorHistorySection from './SettingsEditorHistorySection.vue'
</script>
