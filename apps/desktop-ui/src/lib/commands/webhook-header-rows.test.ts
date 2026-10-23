import { describe, expect, it } from 'vitest'

import {
  addWebhookHeaderRow,
  removeWebhookHeaderRow,
  updateWebhookHeaderRow,
  webhookHeaderRows,
  webhookHeadersFromRows,
} from './webhook-header-rows'

describe('webhook header rows', () => {
  it('converts between headers and rows', () => {
    expect(webhookHeaderRows(undefined)).toEqual([])
    const rows = webhookHeaderRows({ Accept: 'text/plain' })
    expect(rows).toEqual([['Accept', 'text/plain']])
    expect(webhookHeadersFromRows(rows)).toEqual({ Accept: 'text/plain' })
  })

  it('edits one part of one row without touching the others', () => {
    const rows = webhookHeaderRows({ A: '1', B: '2' })
    expect(updateWebhookHeaderRow(rows, 1, 0, 'C')).toEqual([
      ['A', '1'],
      ['C', '2'],
    ])
    expect(updateWebhookHeaderRow(rows, 0, 1, '9')[0]).toEqual(['A', '9'])
    expect(rows).toEqual([
      ['A', '1'],
      ['B', '2'],
    ])
  })

  it('adds a single empty row at a time', () => {
    const added = addWebhookHeaderRow([['A', '1']])
    expect(added).toEqual([
      ['A', '1'],
      ['', ''],
    ])
    expect(addWebhookHeaderRow(added!)).toBeNull()
  })

  it('removes a row by index', () => {
    expect(
      removeWebhookHeaderRow(
        [
          ['A', '1'],
          ['B', '2'],
        ],
        0
      )
    ).toEqual([['B', '2']])
  })
})
