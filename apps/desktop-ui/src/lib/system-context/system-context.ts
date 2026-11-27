import type { SystemInfo } from '@tyco/shared'

/**
 * What every assistant is told about where it runs: the date with its weekday,
 * the time zone and the system. No time of day: the block stays the same all
 * day, so the provider's prompt cache keeps working; the exact time is what the
 * `get_system_info` tool is for. See `docs/assistant-capabilities.md`
 */

export interface SystemContextDependencies {
  loadSystemInfo: () => Promise<SystemInfo>
  now?: () => Date
  /** The IANA time zone of this device; the one of `Intl` by default */
  timeZone?: () => string
  warn?: (message: string) => void
}

const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** `2026-11-27 (Friday)`: the date in `timeZone` with its weekday */
export function dateWithWeekday(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} (${part('weekday')})`
}

/** The block of the system prompt; the system is left out until it is known */
export function systemContextText(
  now: Date,
  timeZone: string,
  os: string | undefined
): string {
  return [
    `Current date: ${dateWithWeekday(now, timeZone)}.`,
    `Time zone: ${timeZone}.`,
    os ? `Operating system: ${os}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** The local time with its offset, e.g. `2026-11-27T16:05:09+03:00` */
export function localIsoTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  // `GMT+03:00`, or `GMT` for UTC itself
  const offset = part('timeZoneName').replace('GMT', '') || '+00:00'
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${offset}`
}

/**
 * Loads the system info once and builds the block from it. The block is wanted
 * synchronously, while the prompt is put together: until the info has come it
 * goes without the system
 */
export function createSystemContext(deps: SystemContextDependencies) {
  const now = deps.now ?? (() => new Date())
  const timeZone = deps.timeZone ?? localTimeZone
  let info: SystemInfo | null = null
  let pending: Promise<SystemInfo | null> | null = null

  function load(): Promise<SystemInfo | null> {
    pending ??= deps.loadSystemInfo().then(
      (loaded) => (info = loaded),
      (error: unknown) => {
        // tried again by the next request
        pending = null
        deps.warn?.(`Could not read the system info: ${String(error)}`)
        return null
      }
    )
    return pending
  }

  return {
    load,
    /** The block for the system prompt */
    text: (): string => {
      if (!info) void load()
      return systemContextText(now(), timeZone(), info?.os)
    },
    /** What the `get_system_info` tool returns */
    details: async () => {
      const loaded = await load()
      const zone = timeZone()
      return {
        localTime: localIsoTime(now(), zone),
        timeZone: zone,
        ...(loaded ?? {}),
      }
    },
  }
}

export type SystemContext = ReturnType<typeof createSystemContext>
