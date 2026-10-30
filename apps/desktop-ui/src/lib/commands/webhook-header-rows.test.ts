import { describe, expect, it } from 'vitest'

import {
  addWebhookHeaderRow,
  duplicateWebhookHeaderRows,
  isSameWebhookHeaders,
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
  it('keeps the first of rows with the same name and skips unnamed rows', () => {
    const rows: [string, string][] = [
      ['Accept', '1'],
      ['', 'x'],
      ['accept ', '2'],
      [' X-Id ', '3'],
    ]
    expect(webhookHeadersFromRows(rows)).toEqual({ Accept: '1', 'X-Id': '3' })
    expect([...duplicateWebhookHeaderRows(rows)]).toEqual([2])
  })

  it('compares header sets in order', () => {
    expect(isSameWebhookHeaders({ A: '1' }, { A: '1' })).toBe(true)
    expect(isSameWebhookHeaders({ A: '1' }, { A: '2' })).toBe(false)
    expect(isSameWebhookHeaders({ A: '1', B: '2' }, { B: '2', A: '1' })).toBe(
      false
    )
  })
})
