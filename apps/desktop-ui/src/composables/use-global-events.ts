import { IndexedEventEmitter } from '@/lib/app/indexed-event-emitter'

const globalEvents = new IndexedEventEmitter()

export { GlobalEvents } from '../lib/app/global-events'

export const useGlobalEvents = () => {
  return { globalEvents }
}
