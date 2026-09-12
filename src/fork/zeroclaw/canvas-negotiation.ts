/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Capability negotiation for the Canvas Action Channel (`ui://` resources).
 *
 * Mirrors `shared/agent-core/skills.ts`'s wire-skills capability exactly: a
 * namespaced `_meta` key the host advertises on session setup, detected via
 * the agent's `initialize` response using the same nesting and narrowing
 * pattern. Unlike the Thunderbolt-owned skills key, `io.modelcontextprotocol/ui`
 * is the MCP-UI community namespace for `ui://` resource support, so it is not
 * prefixed with `thunderboltAcpMetaKey`.
 */

/** ACP extension namespace for MCP-UI `ui://` resource (Canvas Action Channel) support. */
export const CANVAS_META_KEY = 'io.modelcontextprotocol/ui'

type AcpMeta = { readonly [key: string]: unknown } | null | undefined

/** Narrow unknown ACP metadata values to plain records. */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Build ACP session metadata advertising host support for the Canvas Action
 * Channel.
 *
 * @returns namespaced `_meta` fragment the host sends on session setup
 */
export const buildCanvasCapabilityMeta = (): Record<string, unknown> => ({
  [CANVAS_META_KEY]: { supported: true },
})

/**
 * Detect Canvas Action Channel support advertised by an agent.
 *
 * @param meta - agent capability metadata from the `initialize` response
 * @returns whether the agent accepts `ui://` resources on the action channel
 */
export const supportsCanvasCapability = (meta: AcpMeta): boolean => {
  const canvas = meta?.[CANVAS_META_KEY]
  return isRecord(canvas) && canvas.supported === true
}
