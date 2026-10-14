<template>
  <Settings />
</template>

<script setup lang="ts">
import { useNavPanelStore } from '../stores/nav-panel'

const navPanelStore = useNavPanelStore()

navPanelStore.resetNavPanelState({})
</script>
