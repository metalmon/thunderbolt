/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { decodePairingTicket, encodePairingTicket } from './pairing-ticket'

describe('pairing-ticket', () => {
  it('round-trips a ticket with a name', () => {
    const ticket = { nodeId: 'k51qzi5uqu5dh-endpoint-id', name: "Italo's laptop" }
    expect(decodePairingTicket(encodePairingTicket(ticket))).toEqual(ticket)
  })

  it('round-trips a ticket without a name (omits the key)', () => {
    const ticket = { nodeId: 'bare-endpoint-id' }
    const decoded = decodePairingTicket(encodePairingTicket(ticket))
    expect(decoded).toEqual(ticket)
    expect('name' in decoded).toBe(false)
  })

  it('preserves unicode device names', () => {
    const ticket = { nodeId: 'id', name: '日本語 📱' }
    expect(decodePairingTicket(encodePairingTicket(ticket))).toEqual(ticket)
  })

  it('uses the volt-pair scheme prefix', () => {
    expect(encodePairingTicket({ nodeId: 'id' }).startsWith('volt-pair:')).toBe(true)
  })

  // The pre-rename prefix must still decode, and not through the bare-id fallback:
  // that path would hand back the whole `thunderbolt-pair:<base64>` string as an
  // endpoint id, which fails much later and nowhere near the cause.
  it('still decodes a ticket written with the pre-rename prefix', () => {
    const ticket = { nodeId: 'legacy-id', name: 'Old build' }
    const legacy = `thunderbolt-pair:${encodePairingTicket(ticket).slice('volt-pair:'.length)}`
    expect(decodePairingTicket(legacy)).toEqual(ticket)
  })

  it('tolerates a bare node id / raw iroh ticket pasted directly', () => {
    expect(decodePairingTicket('  raw-endpoint-ticket-string  ')).toEqual({ nodeId: 'raw-endpoint-ticket-string' })
  })

  it('throws on empty input', () => {
    expect(() => decodePairingTicket('   ')).toThrow('Empty pairing code')
  })

  it('throws when the encoded payload has no node id', () => {
    const bad = `volt-pair:${btoa('{"name":"x"}').replace(/=+$/, '')}`
    expect(() => decodePairingTicket(bad)).toThrow('missing a node ID')
  })
})
