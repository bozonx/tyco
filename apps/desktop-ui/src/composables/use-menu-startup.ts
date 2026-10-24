import { onMounted } from 'vue'

import { runMenuStartup } from '../lib/modals/menu-startup'

/** Clears the startup parameter before running so returning to the step waits. */
export function useMenuStartup(deps: Parameters<typeof runMenuStartup>[0]) {
  onMounted(() => {
    void runMenuStartup(deps)
  })
}
