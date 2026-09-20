<template>
  <div class="card">
    <slot />
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
  .card {
    border: 1px solid var(--app-border);
    border-radius: var(--radius-md);
    padding: var(--space-lg);
    background-color: var(--app-surface-raised);
    min-height: 0; /* Важно для правильной работы flexbox */
    overflow: hidden; /* Предотвращает выход содержимого за границы */
  }
</style>
