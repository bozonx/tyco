import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { useAiProfilesStore } from './ai-profiles'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('./ipc', () => ({ useIpcStore: () => ({ call: mocks.call }) }))
vi.mock('./desktop', () => ({ useDesktopStore: () => ({ userConfig: {} }) }))
vi.mock('../lib/logger', () => ({ clientLogger: { error: vi.fn() } }))

afterEach(() => vi.resetAllMocks())

it('keeps the latest vault lists when an older load finishes later', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  let resolveOld!: (result: unknown) => void
  let profileCalls = 0
  mocks.call.mockImplementation(async (command: string) => {
    if (command === 'get_ai_vault_path')
      return { success: true, result: '/vault' }
    if (command === 'list_ai_projects') return { success: true, result: [] }
    if (command === 'list_ai_profiles') {
      profileCalls++
      if (profileCalls === 1)
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      return { success: true, result: [{ id: 'new', name: 'New' }] }
    }
    throw new Error(`Unexpected command: ${command}`)
  })
  try {
    const store = useAiProfilesStore()
    const oldLoad = store.loadAll()
    await vi.waitFor(() => expect(profileCalls).toBe(1))
    await store.loadAll()
    resolveOld({ success: true, result: [{ id: 'old', name: 'Old' }] })
    await oldLoad
    expect(store.profiles[0]?.id).toBe('new')
    expect(store.vaultError).toBe('')
  } finally {
    disposePinia(pinia)
  }
})

it('does not repopulate a failed vault load from a late sibling response', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  let resolveProfiles!: (result: unknown) => void
  const profiles = new Promise((resolve) => {
    resolveProfiles = resolve
  })
  mocks.call.mockImplementation(async (command: string) => {
    if (command === 'get_ai_vault_path')
      return { success: true, result: '/vault' }
    if (command === 'list_ai_projects')
      return { success: false, error: 'unavailable' }
    if (command === 'list_ai_profiles') return profiles
    throw new Error(`Unexpected command: ${command}`)
  })
  try {
    const store = useAiProfilesStore()
    await store.loadAll()
    resolveProfiles({ success: true, result: [{ id: 'late', name: 'Late' }] })
    await vi.waitFor(() => expect(store.isLoaded).toBe(true))
    expect(store.profiles).toEqual([])
    expect(store.vaultError).toBe('unavailable')
  } finally {
    disposePinia(pinia)
  }
})

it('does not start obsolete list requests after a delayed vault path read', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  let resolvePath!: (result: unknown) => void
  let pathCalls = 0
  mocks.call.mockImplementation(async (command: string) => {
    if (command === 'get_ai_vault_path') {
      pathCalls++
      if (pathCalls === 1)
        return new Promise((resolve) => {
          resolvePath = resolve
        })
      return { success: true, result: '/new-vault' }
    }
    return { success: true, result: [] }
  })
  try {
    const store = useAiProfilesStore()
    const oldLoad = store.loadAll()
    await store.loadAll()
    resolvePath({ success: true, result: '/old-vault' })
    await oldLoad
    expect(
      mocks.call.mock.calls.filter(
        ([command]) => command === 'list_ai_profiles'
      )
    ).toHaveLength(1)
    expect(store.vaultPath).toBe('/new-vault')
  } finally {
    disposePinia(pinia)
  }
})
