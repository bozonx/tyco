import { describe, expect, it } from 'vitest'

import { createChatLayoutModel } from './chat-layout-model'

describe('createChatLayoutModel', () => {
  it('starts with the sidebar open and toggles open/closed state', () => {
    const model = createChatLayoutModel()
    expect(model.isSidebarOpen.value).toBe(true)

    model.closeSidebar()
    expect(model.isSidebarOpen.value).toBe(false)

    model.openSidebar()
    expect(model.isSidebarOpen.value).toBe(true)
  })
})
