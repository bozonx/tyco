import { describe, expect, it, vi } from 'vitest'

import { createFakeNetIpc } from '../net/fake-net-ipc'
import {
  buildMicrophoneOptions,
  createMicrophoneTester,
  listInputDevices,
} from './input-devices'

describe('input-devices', () => {
  it('lists input devices via IPC', async () => {
    const fake = createFakeNetIpc({
      list_input_devices: () => [
        { id: 'USB Mic', label: 'USB Mic', isDefault: true },
      ],
    })
    await expect(listInputDevices(fake.ipc)).resolves.toEqual([
      { id: 'USB Mic', label: 'USB Mic', isDefault: true },
    ])
  })

  it('builds options with system default first and keeps disconnected selected mic', () => {
    const options = buildMicrophoneOptions({
      devices: [
        { id: 'Built-in', label: 'Built-in', isDefault: true },
        { id: 'Webcam', label: 'Webcam', isDefault: false },
      ],
      selectedId: 'USB Mic',
      systemDefaultLabel: 'System default',
      defaultTagLabel: 'default',
      unavailableTagLabel: 'not connected',
    })
    expect(options).toEqual([
      { id: '', name: 'System default' },
      { id: 'Built-in', name: 'Built-in (default)' },
      { id: 'Webcam', name: 'Webcam' },
      { id: 'USB Mic', name: 'USB Mic (not connected)' },
    ])
  })

  it('starts and stops microphone test capture and reacts to supersede/error', async () => {
    const fake = createFakeNetIpc({
      start_voice_capture: () => ({ sampleRate: 16_000, sessionId: 42 }),
    })
    const onStopped = vi.fn()
    const onError = vi.fn()
    const tester = createMicrophoneTester({ ipc: fake.ipc, onStopped, onError })

    await tester.start('USB Mic')
    expect(fake.callsOf('start_voice_capture')[0]?.args).toMatchObject({
      source: { kind: 'microphone' },
      microphoneId: 'USB Mic',
    })

    // Audio chunks are ignored quietly while meter listens to events
    fake.emit(new Uint8Array([1, 2, 3, 4]).buffer)
    expect(onStopped).not.toHaveBeenCalled()

    fake.emit({ type: 'superseded' })
    expect(onStopped).toHaveBeenCalledTimes(1)

    await tester.start()
    await tester.stop()
    expect(fake.callsOf('stop_voice_capture')).toEqual([
      expect.objectContaining({ args: { sessionId: 42 } }),
    ])

    await tester.start()
    fake.emit({ type: 'error', message: 'Device disconnected' })
    expect(onError).toHaveBeenCalledWith('Device disconnected')
    expect(onStopped).toHaveBeenCalledTimes(2)
  })
})
