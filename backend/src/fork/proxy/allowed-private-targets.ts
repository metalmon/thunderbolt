/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isPrivateOrInternalAddress, parseIpAddress } from '@shared/ip-classification'

/**
 * Whether the universal proxy may reach a private address, and which.
 *
 * Upstream refuses them outright. That guard belongs to a HOSTED product: there the
 * backend is shared, and a URL a user types must never reach the provider's own network.
 * This fork ships inside the customer's perimeter, where the backend, the operator and
 * the users are one organisation and the "internal network" being protected is the same
 * network the model server sits on. Carrying the guard over unchanged makes the product
 * unable to do the one thing it exists for — talk to a local model — which is why a pilot
 * hits "Blocked" the moment it adds its own inference address.
 *
 * Two settings, because the two deployments differ:
 *
 * - `VOLT_PROXY_ALLOW_PRIVATE=true` — this deployment is a closed perimeter; private
 *   targets are its own machines. The kit sets it, since that is the whole premise.
 * - `VOLT_PROXY_ALLOWED_HOSTS=host:port,...` — narrower: only these. For a deployment
 *   that is reachable more widely and wants exactly one internal service opened.
 *
 * Neither is set by default, so an unconfigured backend behaves exactly as upstream.
 */

/** Parse the configured list once per call site's settings read. */
export const parseAllowedPrivateTargets = (raw: string | undefined): readonly string[] =>
  (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)

/**
 * Whether this URL names a host the operator allowed.
 *
 * @param url - the target the proxy was asked to reach
 * @param allowed - entries from {@link parseAllowedPrivateTargets}
 * @returns true when the host, or host:port, is listed
 */

/**
 * Whether this host is inside a network the deployment can call its own.
 *
 * A literal private/internal IP, loopback by name, a single-label name (a container or a
 * LAN host — `powersync`, `inference`), or one of the names reserved for internal use.
 * Everything else — anything with a public-looking domain — is NOT private, which is what
 * keeps the blanket switch from quietly covering `api.openai.com`.
 */
const isPrivateHost = (url: URL): boolean => {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost') return true
  const literal = parseIpAddress(host)
  if (literal) return isPrivateOrInternalAddress(literal)
  if (!host.includes('.')) return true
  return /\.(local|internal|lan|home|intranet)$/.test(host)
}

export const isAllowedPrivateTarget = (
  url: URL,
  allowed: readonly string[],
  allowAllPrivate = false,
): boolean => {
  const host = url.hostname.toLowerCase()
  // Link-local is refused even by the blanket switch: nobody's model server lives at
  // 169.254.x.x, and that range is where a cloud instance keeps its credentials
  // (169.254.169.254). A deployment that genuinely needs one must name it below.
  const linkLocal = host.startsWith('169.254.') || host.startsWith('fe80:')
  // The blanket covers the deployment's OWN network only. Without this it answered yes
  // for every host, and a caller that uses this to decide "do not upgrade to https"
  // would then send a public request in the clear.
  if (allowAllPrivate && !linkLocal && isPrivateHost(url)) return true
  if (allowed.length === 0) return false
  // `url.host` carries the port only when it is non-default, so compare both shapes.
  const hostWithPort = url.port ? `${host}:${url.port}` : url.host.toLowerCase()
  return allowed.includes(host) || allowed.includes(hostWithPort)
}

/** Reads the closed-perimeter switch. Anything but an explicit `true` leaves the guard on. */
export const allowsAllPrivateTargets = (raw: string | undefined): boolean => (raw ?? '').trim().toLowerCase() === 'true'
