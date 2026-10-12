import { IndexedEventEmitter } from '@/lib/squidlet-lib-local'

const globalEvents = new IndexedEventEmitter()

export { GlobalEvents } from '../lib/app/global-events'

export const useGlobalEvents = () => {
  return { globalEvents }
}
