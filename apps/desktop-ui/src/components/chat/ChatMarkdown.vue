<template>
  <div
    ref="root"
    class="chat-markdown selectable"
    v-html="html"
    @click="handleClick"
    @auxclick="handleAuxClick"
    @load.capture="emit('content-resized')"
  />
</template>

<script setup lang="ts">
import 'katex/dist/katex.min.css'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { loadChatImage } from '../../lib/chat/chat-image'
import { renderChatMarkdown } from '../../lib/chat/chat-markdown'
import { createChatMarkdownView } from '../../lib/chat/chat-markdown-view'
import { createTauriFetch } from '../../lib/net/tauri-fetch'
import { tauriNetIpc } from '../../lib/net/tauri-net'
import { useIpcStore } from '../../stores/ipc'

const props = defineProps<{ content: string; streaming?: boolean }>()
const emit = defineEmits<{
  (event: 'copy-code', source: string): void
  (event: 'content-resized'): void
}>()
const root = ref<HTMLElement | null>(null)
const { t, locale } = useI18n()
const ipc = useIpcStore()
const scope = useId()
const markdownLabels = computed(() => ({
  reasoning: t('chat.reasoning'),
  footnotes: t('chat.footnotes'),
  footnoteBack: t('chat.footnoteBack'),
  loadImage: t('chat.loadImage'),
  note: t('chat.alertNote'),
  tip: t('chat.alertTip'),
  important: t('chat.alertImportant'),
  warning: t('chat.alertWarning'),
  caution: t('chat.alertCaution'),
}))
/** A streamed answer is rendered at most this often, not on every piece */
const STREAM_RENDER_MS = 120
function render(): string {
  try {
    return renderChatMarkdown(props.content, markdownLabels.value, scope)
  } catch {
    // a text the renderer chokes on is still shown, as it is
    const text = props.content.replace(
      /[&<>]/g,
      (character) => `&#${character.charCodeAt(0)};`
    )
    return `<p class="chat-plain">${text}</p>`
  }
}
const html = ref(render())
let renderTimer: ReturnType<typeof setTimeout> | undefined
watch([() => props.content, () => props.streaming, markdownLabels], () => {
  if (props.streaming) {
    if (renderTimer !== undefined) return
    renderTimer = setTimeout(() => {
      renderTimer = undefined
      html.value = render()
    }, STREAM_RENDER_MS)
    return
  }
  clearTimeout(renderTimer)
  renderTimer = undefined
  html.value = render()
})
const fetchImage = createTauriFetch(tauriNetIpc, 'chat-image')
const view = createChatMarkdownView({
  async highlight(source, language) {
    const { default: hljs } = await import('highlight.js')
    if (!language) return hljs.highlightAuto(source).value
    if (!hljs.getLanguage(language))
      return source.replace(
        /[&<>]/g,
        (character) => `&#${character.charCodeAt(0)};`
      )
    return hljs.highlight(source, { language }).value
  },
  async renderDiagram(source) {
    const { renderChatMermaid } = await import('../../lib/chat/chat-mermaid')
    return renderChatMermaid(source)
  },
  loadImage: (url, signal) => loadChatImage(url, signal, fetchImage),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  async openLink(url) {
    await ipc.callFunctionOrNotify('openInBrowser', [url])
  },
  copyCode: (source) => emit('copy-code', source),
  labels: () => ({
    copyCode: t('chat.copyCode'),
    diagram: t('chat.diagram'),
    diagramSource: t('chat.diagramSource'),
    diagramError: t('chat.diagramError'),
    imageError: t('chat.imageError'),
    loadingImage: t('chat.loadingImage'),
  }),
})
let timer: ReturnType<typeof setTimeout> | undefined
let revision = 0
watch(
  [html, () => props.streaming, locale],
  async () => {
    const currentRevision = ++revision
    clearTimeout(timer)
    view.reset()
    await nextTick()
    // Status changes may leave v-html unchanged; always start from clean markup.
    if (!root.value || currentRevision !== revision) return
    root.value.innerHTML = html.value
    timer = setTimeout(
      () => {
        if (root.value) void view.enhance(root.value, Boolean(props.streaming))
      },
      props.streaming ? 100 : 0
    )
  },
  { immediate: true, flush: 'post' }
)

function handleClick(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a'))
    event.preventDefault()
  void view.handleClick(event, root.value)
}

function handleAuxClick(event: MouseEvent) {
  if (event.button === 1) handleClick(event)
}

onBeforeUnmount(() => {
  revision += 1
  clearTimeout(timer)
  clearTimeout(renderTimer)
  view.dispose()
})
</script>

<style scoped>
.chat-markdown {
  color: var(--color-base-content);
  font-size: var(--text-title);
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.chat-markdown :deep(.chat-plain) {
  white-space: pre-wrap;
}
.chat-markdown :deep(> :first-child) {
  margin-top: 0;
}
.chat-markdown :deep(> :last-child) {
  margin-bottom: 0;
}
.chat-markdown :deep(p),
.chat-markdown :deep(ul),
.chat-markdown :deep(ol),
.chat-markdown :deep(blockquote),
.chat-markdown :deep(pre),
.chat-markdown :deep(table) {
  margin: 0.75em 0;
}
.chat-markdown :deep(ul),
.chat-markdown :deep(ol) {
  padding-left: 1.5rem;
}
.chat-markdown :deep(h1) {
  font-size: 1.35rem;
}
.chat-markdown :deep(h2) {
  font-size: 1.18rem;
}
.chat-markdown :deep(h3) {
  font-size: 1.05rem;
}
.chat-markdown :deep(a[href]) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chat-markdown :deep(a:not([href])) {
  color: inherit;
  text-decoration: none;
}
.chat-markdown :deep(blockquote) {
  padding-left: var(--space-md);
  border-left: 3px solid var(--app-border-strong);
  color: var(--app-text-muted);
}
.chat-markdown :deep(code:not(pre code)) {
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
  font-family: var(--font-mono);
  font-size: 0.85em;
}
.chat-markdown :deep(pre) {
  position: relative;
  padding: 2.25rem var(--space-lg) var(--space-lg);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: var(--app-surface-raised);
  overflow: auto;
}
.chat-markdown :deep(pre code) {
  font-family: var(--font-mono);
  font-size: var(--text-control);
}
.chat-markdown :deep(.code-copy) {
  position: absolute;
  top: 0.35rem;
  right: 0.4rem;
  padding: 0.2rem 0.45rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  font-size: 0.7rem;
  cursor: pointer;
}
.chat-markdown :deep(.code-copy:hover) {
  background: var(--app-hover);
}
.chat-markdown :deep(table) {
  display: block;
  max-width: 100%;
  border-collapse: collapse;
  overflow-x: auto;
}
.chat-markdown :deep(th),
.chat-markdown :deep(td) {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--app-border);
  text-align: left;
}
.chat-markdown :deep(ul) {
  list-style: disc;
}
.chat-markdown :deep(ol) {
  list-style: decimal;
}
.chat-markdown :deep(ul ul) {
  list-style: circle;
}
.chat-markdown :deep(ul ul ul) {
  list-style: square;
}
.chat-markdown :deep(.task-list-item) {
  list-style: none;
}
.chat-markdown :deep(input[type='checkbox']) {
  margin-right: 0.4em;
  accent-color: var(--color-primary);
}
.chat-markdown :deep(h1),
.chat-markdown :deep(h2),
.chat-markdown :deep(h3),
.chat-markdown :deep(h4),
.chat-markdown :deep(h5),
.chat-markdown :deep(h6) {
  display: block;
  margin: 1.1em 0 0.45em;
  min-height: 0;
  color: inherit;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 650;
  line-height: 1.3;
}
.chat-markdown :deep(h4) {
  font-size: 1rem;
}
.chat-markdown :deep(h5) {
  font-size: var(--text-title);
}
.chat-markdown :deep(h6) {
  font-size: var(--text-body);
  color: var(--app-text-muted);
}
.chat-markdown :deep(th[align='center']),
.chat-markdown :deep(td[align='center']) {
  text-align: center;
}
.chat-markdown :deep(th[align='right']),
.chat-markdown :deep(td[align='right']) {
  text-align: right;
}
.chat-markdown :deep(th) {
  font-weight: 650;
  background: var(--app-surface-raised);
}
.chat-markdown :deep(hr) {
  margin: 1.2em 0;
  border-color: var(--app-border);
}
.chat-markdown :deep(details) {
  margin: 0.75em 0;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
}
.chat-markdown :deep(summary) {
  display: list-item;
  cursor: pointer;
  font-weight: 600;
}
.chat-markdown :deep(.footnotes) {
  margin-top: 1.5rem;
  border-top: 1px solid var(--app-border);
  font-size: 0.85em;
}
.chat-markdown :deep(img) {
  max-width: 100%;
  height: auto;
}
.chat-markdown :deep(.chat-image) {
  display: block;
}
.chat-markdown :deep(.chat-image-alt) {
  color: var(--app-text-muted);
  font-size: 0.85em;
}
.chat-markdown :deep(.chat-image-alt:not([hidden])) {
  display: block;
}
.chat-markdown :deep(.chat-image button) {
  margin: 0.4rem 0;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-primary);
}
.chat-markdown :deep(.chat-image button:disabled) {
  cursor: wait;
  opacity: 0.6;
}
.chat-markdown :deep(.chat-alert) {
  padding: 0.5rem 0.8rem;
  border-left-color: var(--color-primary);
  background: var(--app-surface-raised);
  border-radius: var(--radius-sm);
}
.chat-markdown :deep(.chat-alert-tip) {
  border-left-color: var(--color-success);
}
.chat-markdown :deep(.chat-alert-important) {
  border-left-color: var(--color-secondary);
}
.chat-markdown :deep(.chat-alert-warning) {
  border-left-color: var(--color-warning);
}
.chat-markdown :deep(.chat-alert-caution) {
  border-left-color: var(--color-error);
}
.chat-markdown :deep(.chat-alert-title) {
  margin: 0 0 0.35em;
  color: var(--color-base-content);
  font-weight: 650;
}
.chat-markdown :deep(.katex-display) {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.25rem 0;
}
.chat-markdown :deep(.katex) {
  font-size: 1.1em;
}
.chat-markdown :deep(.chat-diagram) {
  margin: 0.75em 0;
}
.chat-markdown :deep(.chat-diagram-preview) {
  max-width: 100%;
  overflow-x: auto;
  padding: 0.6rem;
  background: white;
  border-radius: var(--radius-sm);
}
.chat-markdown :deep(.chat-diagram-preview img) {
  display: block;
  max-width: none;
  height: auto;
}
.chat-markdown :deep(.chat-render-error) {
  color: var(--color-error);
  font-size: 0.85em;
}
.chat-markdown :deep(.hljs-keyword),
.chat-markdown :deep(.hljs-selector-tag),
.chat-markdown :deep(.hljs-literal) {
  color: var(--app-syntax-keyword);
}
.chat-markdown :deep(.hljs-string),
.chat-markdown :deep(.hljs-regexp),
.chat-markdown :deep(.hljs-attr) {
  color: var(--app-syntax-string);
}
.chat-markdown :deep(.hljs-number),
.chat-markdown :deep(.hljs-symbol) {
  color: var(--app-syntax-number);
}
.chat-markdown :deep(.hljs-title),
.chat-markdown :deep(.hljs-built_in),
.chat-markdown :deep(.hljs-type) {
  color: var(--app-syntax-meta);
}
.chat-markdown :deep(.hljs-comment),
.chat-markdown :deep(.hljs-quote) {
  color: var(--app-syntax-comment);
  font-style: italic;
}
.chat-markdown :deep(.hljs-addition) {
  color: var(--color-success);
}
.chat-markdown :deep(.hljs-deletion) {
  color: var(--color-error);
}
</style>
