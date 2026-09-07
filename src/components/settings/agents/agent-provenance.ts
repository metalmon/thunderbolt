/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { i18n } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import type { Agent } from '@/types/acp'

/**
 * Human label for where an ACP agent lives: the endpoint host for WebSocket
 * agents, or a generic peer label for iroh targets (a bare NodeId / ticket is
 * not a URL and is too long to display). Never throws in render.
 */
export const acpEndpointLabel = (agent: Pick<Agent, 'transport' | 'url'>): string => {
  if (agent.transport === 'iroh') {
    return 'iroh peer'
  }
  if (!agent.url) {
    return ''
  }
  try {
    return new URL(agent.url).host
  } catch {
    return agent.url
  }
}

/**
 * Secondary provenance line for an agent row and the detail-header subtitle.
 * Tells the user where the agent came from; both surfaces read the same
 * string so the row and the detail never drift.
 */
// Module-scope `msg` descriptors, resolved at the call site with the global
// `i18n` singleton (the same instance the app activates). `msg` at module scope
// only builds a descriptor — resolving here, inside the per-render call, picks
// up the active locale and re-localizes when the settings tree re-renders on a
// language switch (see the Localization notes in AGENTS.md).
const builtInProvenance = msg`Your agent · built into the app`
const systemProvenance = msg`System agent · always available`

export const agentProvenanceLine = (agent: Agent): string => {
  if (agent.type === 'built-in') {
    return i18n._(builtInProvenance)
  }
  if (agent.isSystem === 1) {
    return i18n._(systemProvenance)
  }
  const endpoint = acpEndpointLabel(agent)
  return i18n._(msg`Connected agent · ${endpoint}`)
}
