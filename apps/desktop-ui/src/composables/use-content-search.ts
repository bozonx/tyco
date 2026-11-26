import {
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from 'vue'

import {
  createContentSearchSession,
  type ContentSearchSession,
} from '../lib/search/content-search'

export interface UseContentSearchOptions {
  containerRef: Ref<HTMLElement | null>
  scopeElementRef?: Ref<HTMLElement | null>
}

export function useContentSearch(options: UseContentSearchOptions) {
  const isOpen = ref(false)
  const query = ref('')
  const matchCase = ref(false)
  const session = ref<ContentSearchSession | null>(null)

  const count = computed(() => session.value?.count ?? 0)
  const activeIndex = computed(() => session.value?.activeIndex ?? -1)

  const runSearch = (keepIndex = false) => {
    session.value?.destroy()
    const container = options.containerRef.value
    if (!isOpen.value || !container || !query.value.trim()) {
      session.value = null
      return
    }
    const prevIndex =
      keepIndex && session.value && session.value.activeIndex >= 0
        ? session.value.activeIndex
        : 0
    session.value = createContentSearchSession(container, query.value, {
      matchCase: matchCase.value,
      initialIndex: prevIndex,
    })
  }

  watch([query, matchCase, isOpen], () => {
    runSearch()
  })

  let observer: MutationObserver | null = null

  const startObserver = () => {
    if (typeof MutationObserver === 'undefined') return
    stopObserver()
    const container = options.containerRef.value
    if (!container) return

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (isOpen.value && query.value.trim()) {
          runSearch(true)
        }
      }, 80)
    })

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  const stopObserver = () => {
    observer?.disconnect()
    observer = null
  }

  watch(isOpen, (open) => {
    if (open) {
      void nextTick(() => {
        startObserver()
        runSearch()
      })
    } else {
      stopObserver()
      session.value?.destroy()
      session.value = null
    }
  })

  const open = () => {
    isOpen.value = true
  }

  const close = () => {
    isOpen.value = false
  }

  const toggle = () => {
    isOpen.value = !isOpen.value
  }

  const next = () => {
    session.value?.next()
  }

  const previous = () => {
    session.value?.previous()
  }

  const onWindowKeyDown = (event: KeyboardEvent) => {
    const isCtrlF =
      (event.ctrlKey || event.metaKey) &&
      (event.key === 'f' || event.key === 'F' || event.code === 'KeyF')

    if (isCtrlF) {
      if (options.scopeElementRef?.value) {
        const scope = options.scopeElementRef.value
        const active = document.activeElement
        if (active && !scope.contains(active) && active !== document.body) {
          return
        }
      }
      event.preventDefault()
      if (!isOpen.value) {
        open()
      } else {
        const searchInput =
          options.containerRef.value?.ownerDocument.querySelector<HTMLInputElement>(
            '.content-search-bar input[type="search"]'
          )
        searchInput?.focus()
        searchInput?.select()
      }
      return
    }

    if (!isOpen.value) return

    if (event.key === 'F3') {
      event.preventDefault()
      if (event.shiftKey) {
        previous()
      } else {
        next()
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const destroy = () => {
    window.removeEventListener('keydown', onWindowKeyDown)
    stopObserver()
    session.value?.destroy()
    session.value = null
  }

  if (getCurrentInstance()) {
    onMounted(() => {
      window.addEventListener('keydown', onWindowKeyDown)
    })
    onBeforeUnmount(() => {
      destroy()
    })
  } else {
    window.addEventListener('keydown', onWindowKeyDown)
  }

  return {
    isOpen,
    query,
    matchCase,
    count,
    activeIndex,
    open,
    close,
    toggle,
    next,
    previous,
    refresh: runSearch,
    destroy,
  }
}
