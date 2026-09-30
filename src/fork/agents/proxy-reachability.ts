/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'

/**
 * Fork: a loopback agent address cannot work in the hosted build.
 *
 * The desktop app dials an agent WebSocket directly, so `127.0.0.1` there is
 * the user's own machine and is exactly right. In the browser build the socket
 * is proxied: the backend resolves the target on ITS host, where loopback is
 * the backend's own — never the user's. The connection then fails in a way
 * that looks like the agent is down, so it is worth saying at the point the
 * address is typed.
 *
 * A hint, not a block: what is reachable is a property of the deployment, and
 * refusing to save an address the user may well be able to reach from their own
 * environment would be a worse error than letting the test report it.
 */

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

export const loopbackThroughProxyMessage: MessageDescriptor = msg`This is your own machine's address. The desktop app can reach it, but in the browser the connection is made by the server, which would look for the agent on itself.`

/**
 * Whether `url` names a loopback host while the app cannot dial it directly.
 * Anything unparseable is nobody's business here — URL validation owns that.
 */
export const isLoopbackBeyondProxy = (url: string, dialsDirectly: boolean): boolean => {
  if (dialsDirectly || url.trim() === '') {
    return false
  }
  try {
    return loopbackHosts.has(new URL(url.trim()).hostname.toLowerCase())
  } catch {
    return false
  }
}
