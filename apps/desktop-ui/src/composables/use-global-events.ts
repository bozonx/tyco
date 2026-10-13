import { IndexedEventEmitter } from '@/lib/app/indexed-event-emitter'

import type { GlobalEventArgs } from '../lib/app/global-events'

const globalEvents = new IndexedEventEmitter<GlobalEventArgs>()

export { GlobalEvents } from '../lib/app/global-events'

export const useGlobalEvents = () => {
  return { globalEvents }
}
