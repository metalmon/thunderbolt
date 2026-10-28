/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Whether a host is this machine.
 *
 * Not `isLocalhostUrl` from `@/lib/utils`: that one matches the literal prefix
 * `http://localhost` and so misses `127.0.0.1` and `[::1]`. It is left alone —
 * it has another caller and another purpose — but here the answer decides
 * whether a bearer token may travel in the clear, so it has to be right.
 */
const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '[::1]' ||
  hostname === '::1' ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)

export type AddressVerdict =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: 'empty' | 'unparseable' | 'insecure-scheme' }

/**
 * Whether a typed backend address may be used, and what host it actually names.
 *
 * The host is returned so the caller can show it on its own line before the
 * user agrees. That is the point of this check: the risk here is not a typo, it
 * is someone being TALKED INTO pasting an address, after which the app's bearer
 * token goes wherever that address points. A hostname the user reads back is the
 * cheapest defence against it, and far more use than any validation rule.
 *
 * `https:` only, with `http:` allowed for the loopback — a plain-HTTP address on
 * a real network would carry the token in the clear, which is the one mistake a
 * validator can actually prevent.
 *
 * Note it accepts hosts it cannot reach: reachability is a separate question,
 * answered by trying. This only refuses what must never be tried.
 */
export const verifyServerAddress = (raw: string): AddressVerdict => {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'unparseable' }
  }
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) {
    return { ok: true, url: trimmed, host: parsed.host }
  }
  return { ok: false, reason: 'insecure-scheme' }
}

/** Whether this build lets the user retarget the backend at all.
 *
 *  Off by default. A field like this is reachable by persuasion rather than by
 *  code, which is a path an OEM delivery should not have — the address there is
 *  a deployment fact. The pilot build turns it on, because a technician installs
 *  it and a changed TLS terminator would otherwise mean a rebuild. */
export const isServerEditAllowed = (): boolean => import.meta.env.VITE_VOLT_ALLOW_SERVER_EDIT === 'true'
