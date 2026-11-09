import { describe, expect, it } from 'vitest'

import { createFakeNetIpc } from '../net/fake-net-ipc'
import { levelBars, watchAudioApps } from './audio-apps'

describe('audio apps', () => {
  it('lists the playing applications until stopped', async () => {
    const fake = createFakeNetIpc({
      ['watch_audio_apps']: () => 4,
      ['unwatch_audio_apps']: () => undefined,
    })
    const lists: string[][] = []
    const watch = await watchAudioApps(fake.ipc, (apps) =>
      lists.push(apps.map((app) => app.id))
    )
    fake.emit({
      type: 'apps',
      apps: [{ id: 'firefox', label: 'Firefox', level: 0.4 }],
    })
    watch.stop()
    fake.emit({ type: 'apps', apps: [] })

    expect(lists).toEqual([['firefox']])
    expect(fake.callsOf('unwatch_audio_apps')).toEqual([
      expect.objectContaining({ args: { watchId: 4 } }),
    ])
  })

  it('shows a level as bars', () => {
    expect(levelBars(0)).toBe('▯▯▯')
    expect(levelBars(0.1)).toBe('▮▯▯')
    expect(levelBars(1)).toBe('▮▮▮')
  })
})
