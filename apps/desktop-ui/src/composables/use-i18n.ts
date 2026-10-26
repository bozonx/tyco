import { useI18n as useVueI18n } from 'vue-i18n'
import { adaptModShortcuts } from '../lib/hotkeys/mod-shortcuts'

export function useI18n() {
  const i18n = useVueI18n({ useScope: 'global' })
  const t = ((...args: Parameters<typeof i18n.t>) => {
    const result = i18n.t(...args)
    return typeof result === 'string' ? adaptModShortcuts(result) : result
  }) as typeof i18n.t

  return { ...i18n, t }
}
