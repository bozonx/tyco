import { computed, ref } from 'vue'

export interface PromptPageNavigationDependencies {
  /** How many pages there are to step through */
  pageCount: () => number
}

/**
 * The page a prompts menu shows. It turns the pages the way the action menu
 * does: a hotkey asking for the page already shown, or repeating its last
 * request, steps to the next page.
 */
export function createPromptPageNavigation(
  deps: PromptPageNavigationDependencies
) {
  const pageIndex = ref(0)
  let lastRequestedPageIndex = 0
  const pageCount = computed(() => Math.max(0, deps.pageCount()))

  const clamp = (index: number) =>
    Math.max(0, Math.min(index, pageCount.value - 1))

  const setPage = (index: number) => {
    pageIndex.value = clamp(index)
  }

  const step = (delta: number) => {
    const count = pageCount.value
    if (count <= 1) return
    pageIndex.value = (pageIndex.value + delta + count) % count
  }

  /** Opens the page a hotkey asked for */
  const openPage = (index: number) => {
    lastRequestedPageIndex = index
    setPage(index)
  }

  /** Handles a page hotkey pressed again while the menu is open */
  const repeatOpenPage = (index: number) => {
    const previous = lastRequestedPageIndex
    lastRequestedPageIndex = index
    const target = clamp(index)
    if (index !== previous && target !== pageIndex.value) {
      pageIndex.value = target
    } else {
      step(1)
    }
  }

  return {
    pageIndex,
    pageCount,
    setPage,
    nextPage: () => step(1),
    prevPage: () => step(-1),
    openPage,
    repeatOpenPage,
  }
}

export type PromptPageNavigation = ReturnType<typeof createPromptPageNavigation>
