/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A device pairing ticket carries the opaque iroh P2P identity (endpoint id or
 * `EndpointTicket`) that another device scans to bind it into the devices table.
 */
export type PairingTicket = {
  /** Opaque iroh endpoint identity / EndpointTicket string. Treated as a blob — never parsed. */
  nodeId: string
  /** Optional human-friendly device name, shown while pairing. */
  name?: string
}

const pairingScheme = 'volt-pair'

/**
 * The pre-rename prefix. Accepted on the way IN, never emitted: a ticket printed by
 * an older CLI or desktop build must still pair, and the decoder's bare-id fallback
 * would otherwise swallow one whole — treating `thunderbolt-pair:<base64>` as if the
 * entire string were an endpoint id, which fails later and far from here.
 */
const legacyPairingScheme = 'thunderbolt-pair'

/** The scheme `value` carries, or null when it carries none (a bare endpoint id). */
const schemeOf = (value: string): string | null =>
  [pairingScheme, legacyPairingScheme].find((scheme) => value.startsWith(`${scheme}:`)) ?? null

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromBase64Url = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/**
 * Encode a pairing ticket as a compact, scannable `volt-pair:<base64url>` string
 * suitable for rendering into a QR code.
 */
export const encodePairingTicket = (ticket: PairingTicket): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(ticket))
  return `${pairingScheme}:${toBase64Url(bytes)}`
}

/**
 * Decode a scanned/pasted pairing string back into a {@link PairingTicket}.
 * Tolerant twice over: a bare endpoint id / iroh ticket (no scheme prefix) is accepted as
 * the node id, so scanning a raw ticket the CLI prints also works, and the pre-rename
 * `thunderbolt-pair:` prefix still decodes. Throws on empty or malformed input.
 */
export const decodePairingTicket = (raw: string): PairingTicket => {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('Empty pairing code')
  }

  const scheme = schemeOf(trimmed)
  if (!scheme) {
    return { nodeId: trimmed }
  }

  const json = new TextDecoder().decode(fromBase64Url(trimmed.slice(scheme.length + 1)))
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Malformed pairing code')
  }

  const record = parsed as Record<string, unknown>
  if (typeof record.nodeId !== 'string' || record.nodeId.length === 0) {
    throw new Error('Pairing code is missing a node ID')
  }

  return typeof record.name === 'string' ? { nodeId: record.nodeId, name: record.name } : { nodeId: record.nodeId }
}
