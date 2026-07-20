/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

export type DeliveredUriRef = {
  uri: string
  localFileId: string
  turnPosition: number
  mimeType: string
  storageBasename: string
}

/** Turn-scoped live map. Cleared at turn boundaries by callers when needed. */
const byUri = new Map<string, DeliveredUriRef>()
const byTurnPosition = new Map<number, DeliveredUriRef>()

export const clearDeliveredUriRefMap = (): void => {
  byUri.clear()
  byTurnPosition.clear()
}

export const upsertDeliveredUriRef = (ref: DeliveredUriRef): void => {
  const prev = byUri.get(ref.uri)
  if (prev) {
    byTurnPosition.delete(prev.turnPosition)
  }
  byUri.set(ref.uri, ref)
  byTurnPosition.set(ref.turnPosition, ref)
}

export const getDeliveredUriRefByUri = (uri: string): DeliveredUriRef | undefined => byUri.get(uri)

export const getDeliveredUriRefByTurnPosition = (turnPosition: number): DeliveredUriRef | undefined =>
  byTurnPosition.get(turnPosition)

export const listDeliveredUriRefs = (): DeliveredUriRef[] =>
  Array.from(byUri.values()).sort((a, b) => a.turnPosition - b.turnPosition)

/** Next 1-based turn position among successful deliveries in this map. */
export const nextDeliveredTurnPosition = (): number => listDeliveredUriRefs().length + 1
