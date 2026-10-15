<template>
  <button type="button" class="inline-action"><slot /></button>
</template>
<style scoped>
.inline-action {
  display: inline;
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.inline-action:hover {
  color: var(--color-base-content);
}
</style>
