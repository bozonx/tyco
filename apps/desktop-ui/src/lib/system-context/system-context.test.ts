import { describe, expect, it, vi } from 'vitest'

import {
  createSystemContext,
  dateWithWeekday,
  localIsoTime,
  systemContextText,
  usableTimeZone,
} from './system-context'

const INFO = {
  os: 'Linux (Fedora Linux 44)',
  arch: 'x86_64',
  displayServer: 'wayland',
  desktop: 'KDE',
}
// Friday 2026-11-27, 23:30 UTC: already Saturday in Moscow
const NOW = new Date('2026-11-27T23:30:00Z')

describe('system context', () => {
  it('tells the date with its weekday in the time zone', () => {
    expect(dateWithWeekday(NOW, 'UTC')).toBe('2026-11-27 (Friday)')
    expect(dateWithWeekday(NOW, 'Europe/Moscow')).toBe('2026-11-28 (Saturday)')
  })

  it('tells the local time with its offset', () => {
    expect(localIsoTime(NOW, 'Europe/Moscow')).toBe('2026-11-28T02:30:00+03:00')
    expect(localIsoTime(NOW, 'UTC')).toBe('2026-11-27T23:30:00+00:00')
  })

  it('gives no time of day, so the block stays the same all day', () => {
    const text = systemContextText(NOW, 'UTC', INFO.os)
    expect(text).toBe(
      'Current date: 2026-11-27 (Friday). Time zone: UTC. Operating system: Linux (Fedora Linux 44).'
    )
    expect(
      systemContextText(new Date('2026-11-27T01:00:00Z'), 'UTC', INFO.os)
    ).toBe(text)
  })

  it('goes without the system until it is loaded, and loads it once', async () => {
    const loadSystemInfo = vi.fn().mockResolvedValue(INFO)
    const context = createSystemContext({
      loadSystemInfo,
      now: () => NOW,
      timeZone: () => 'UTC',
    })
    expect(context.text()).not.toContain('Operating system')
    await context.load()
    expect(context.text()).toContain(
      'Operating system: Linux (Fedora Linux 44).'
    )
    await context.details()
    expect(loadSystemInfo).toHaveBeenCalledOnce()
  })

  it('tries again after a failed load', async () => {
    const warn = vi.fn()
    const loadSystemInfo = vi
      .fn()
      .mockRejectedValueOnce(new Error('ipc'))
      .mockResolvedValue(INFO)
    const context = createSystemContext({
      loadSystemInfo,
      now: () => NOW,
      timeZone: () => 'UTC',
      warn,
    })
    expect(await context.load()).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    expect(await context.details()).toEqual({
      localTime: '2026-11-27T23:30:00+00:00',
      timeZone: 'UTC',
      ...INFO,
    })
  })

  it('falls back to UTC for a time zone Intl does not take', () => {
    expect(usableTimeZone('Europe/Moscow')).toBe('Europe/Moscow')
    expect(usableTimeZone('Etc/Unknown-Zone')).toBe('UTC')
    expect(usableTimeZone('')).toBe('UTC')
    expect(usableTimeZone(undefined)).toBe('UTC')
    const context = createSystemContext({
      loadSystemInfo: async () => INFO,
      now: () => NOW,
      timeZone: () => 'Not/AZone',
    })
    expect(context.text()).toContain('Time zone: UTC.')
  })

  it('tells UTC when the time zone cannot be read', async () => {
    const context = createSystemContext({
      loadSystemInfo: async () => INFO,
      now: () => NOW,
      timeZone: () => {
        throw new RangeError('no zone')
      },
    })
    expect((await context.details()).timeZone).toBe('UTC')
  })
})
