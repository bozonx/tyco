import { onMounted } from 'vue'

/** Clears the startup parameter before running so returning to the step waits. */
export function useMenuStartup(deps: {
  getValue: () => string | undefined
  consume: () => void
  run: (value: string) => Promise<void>
}) {
  onMounted(() => {
    const value = deps.getValue()
    if (!value) return
    deps.consume()
    void deps.run(value)
  })
}
