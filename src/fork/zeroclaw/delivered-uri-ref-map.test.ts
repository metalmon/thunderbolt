/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, test, beforeEach } from 'vitest'
import {
  clearDeliveredUriRefMap,
  getDeliveredUriRefByTurnPosition,
  getDeliveredUriRefByUri,
  listDeliveredUriRefs,
  upsertDeliveredUriRef,
  type DeliveredUriRef,
} from './delivered-uri-ref-map'

const sample = (over: Partial<DeliveredUriRef> = {}): DeliveredUriRef => ({
  uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
  localFileId: 'local-1',
  turnPosition: 1,
  mimeType: 'application/pdf',
  storageBasename: 'a1b2c3d4e5f6.pdf',
  title: 'Договор аренды.pdf',
  ...over,
})

describe('delivered-uri-ref-map', () => {
  beforeEach(() => {
    clearDeliveredUriRefMap()
  })

  test('upsert then get by uri and turnPosition', () => {
    upsertDeliveredUriRef(sample())
    expect(getDeliveredUriRefByUri('attachment://deliver/a1b2c3d4e5f6.pdf')?.localFileId).toBe('local-1')
    expect(getDeliveredUriRefByTurnPosition(1)?.uri).toBe('attachment://deliver/a1b2c3d4e5f6.pdf')
    expect(listDeliveredUriRefs()).toHaveLength(1)
  })

  test('second upsert same uri replaces entry and keeps latest turnPosition', () => {
    upsertDeliveredUriRef(sample({ turnPosition: 1, localFileId: 'old' }))
    upsertDeliveredUriRef(sample({ turnPosition: 2, localFileId: 'new' }))
    expect(getDeliveredUriRefByUri('attachment://deliver/a1b2c3d4e5f6.pdf')?.localFileId).toBe('new')
    expect(getDeliveredUriRefByTurnPosition(2)?.localFileId).toBe('new')
  })

  test('unknown uri / position returns undefined', () => {
    expect(getDeliveredUriRefByUri('attachment://deliver/missing.pdf')).toBeUndefined()
    expect(getDeliveredUriRefByTurnPosition(9)).toBeUndefined()
  })

  test('clear empties the map', () => {
    upsertDeliveredUriRef(sample())
    expect(listDeliveredUriRefs()).toHaveLength(1)
    clearDeliveredUriRefMap()
    expect(listDeliveredUriRefs()).toHaveLength(0)
  })
})
