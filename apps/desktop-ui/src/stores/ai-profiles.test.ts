import type { AiProfile } from '@tyco/shared'
import { disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FakeDesktopError } from '../test/fake-desktop-backend'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import { useAiProfilesStore } from './ai-profiles'

vi.mock('../lib/logger', () => ({ clientLogger: { error: vi.fn() } }))

/** A reply the test sends later, to reorder responses */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const profile = (id: string, name: string) => ({ id, name }) as AiProfile

let desktop: TestDesktop

beforeEach(async () => {
  desktop = await loadFakeDesktop()
})

afterEach(() => {
  disposePinia(desktop.pinia)
  desktop.dispose()
})

it('keeps the latest vault lists when an older load finishes later', async () => {
  const old = deferred<AiProfile[]>()
  let profileCalls = 0
  desktop.backend.handle('list_ai_profiles', () => {
    profileCalls++
    return profileCalls === 1 ? old.promise : [profile('new', 'New')]
  })
  const store = useAiProfilesStore()
  const oldLoad = store.loadAll()
  await vi.waitFor(() => expect(profileCalls).toBe(1))
  await store.loadAll()
  old.resolve([profile('old', 'Old')])
  await oldLoad
  expect(store.profiles[0]?.id).toBe('new')
  expect(store.vaultError).toBe('')
})

it('does not repopulate a failed vault load from a late sibling response', async () => {
  const profiles = deferred<AiProfile[]>()
  desktop.backend.handle('list_ai_projects', () => {
    throw new FakeDesktopError({
      code: 'operationFailed',
      message: 'unavailable',
    })
  })
  desktop.backend.handle('list_ai_profiles', () => profiles.promise)
  const store = useAiProfilesStore()
  await store.loadAll()
  profiles.resolve([profile('late', 'Late')])
  await vi.waitFor(() => expect(store.isLoaded).toBe(true))
  expect(store.profiles).toEqual([])
  expect(store.vaultError).toBe('unavailable')
})

it('announces SOUL changes separately from the profile JSON revision and isolates vaults', async () => {
  const { DESKTOP_EVENTS } = await import('@tyco/shared')
  const store = useAiProfilesStore()
  await store.loadAll()
  await desktop.emit(DESKTOP_EVENTS.STORAGE_CHANGED, {
    paths: [],
    vaultChanges: [{ vaultId: 'work', path: 'profiles/writer/SOUL.md' }],
  })
  await vi.waitFor(() =>
    expect(store.profileStorageRevisions['work:writer']).toBe(1)
  )
  expect(store.profileStorageRevisions.writer).toBeUndefined()
  await desktop.emit(DESKTOP_EVENTS.STORAGE_CHANGED, {
    paths: [],
    vaultChanges: [{ vaultId: '', path: 'profiles/writer/SOUL.md' }],
  })
  await vi.waitFor(() => expect(store.profileStorageRevisions.writer).toBe(1))
})
