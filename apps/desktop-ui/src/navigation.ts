import router from './router'
import { createAppNavigation } from './lib/navigation/navigation'

export const appNavigation = createAppNavigation(router)
