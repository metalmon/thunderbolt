/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork: does this account actually have access to THIS agent?
 *
 * ZeroClaw's RBAC gates per agent at `session/new`, while connect and
 * `initialize` are only principal-level — "does the principal have any agents
 * at all". A connection test that stops at `initialize` therefore passes for an
 * agent the user cannot use, and the refusal only lands on their first message
 * (verified against a live pilot: paired as a principal whose role allows one
 * agent, tested a different one, got a green check and then
 * `agent_not_permitted` on the first chat).
 *
 * So the probe mints a session and immediately cancels it. The rule that keeps
 * this safe for every other agent: only an explicit denial is an answer. Any
 * other failure — an agent that does not implement `session/new`, a transient
 * error — leaves the verdict `unknown`, because `initialize` already succeeded
 * and a probe must not invent a failure it cannot prove.
 */

/** ACP requires a `cwd`; browsers have no path to offer, so mirror the adapter's
 *  launch-relative directory. */
const sessionCwd = '.'

export type AgentAccessVerdict = 'permitted' | 'denied' | 'unknown'

/** The slice of an ACP connection this probe drives. */
export type AgentAccessConnection = {
  newSession?: (params: { cwd: string; mcpServers: never[] }) => Promise<{ sessionId: string }>
  cancel?: (params: { sessionId: string }) => Promise<void>
}

type JsonRpcLike = { code?: number; message?: string; data?: unknown }

const denialReason = 'agent_not_permitted'

const reasonOf = (error: unknown): string | undefined => {
  const data = (error as JsonRpcLike | null | undefined)?.data
  if (typeof data !== 'object' || data === null) {
    return undefined
  }
  const reason = (data as { reason?: unknown }).reason
  return typeof reason === 'string' ? reason : undefined
}

/**
 * An RBAC refusal for this specific agent. The runtime answers `-32602` with
 * `data.reason = "agent_not_permitted"`; the message is matched too, since
 * `data` is typed `unknown` in the SDK and a transport may flatten it away.
 */
export const isAgentNotPermitted = (error: unknown): boolean => {
  if (reasonOf(error) === denialReason) {
    return true
  }
  const message = (error as JsonRpcLike | null | undefined)?.message
  return typeof message === 'string' && /not permitted for this principal/i.test(message)
}

/**
 * Mints a throwaway session to find out whether this account may use the agent
 * behind `connection`, then cancels it. Never throws.
 */
export const probeAgentAccess = async (connection: AgentAccessConnection): Promise<AgentAccessVerdict> => {
  if (!connection.newSession) {
    return 'unknown'
  }
  try {
    const { sessionId } = await connection.newSession({ cwd: sessionCwd, mcpServers: [] })
    // Fire-and-forget, exactly as the adapter cancels a turn: the session is
    // disposable and the transport closes right after this anyway.
    void connection.cancel?.({ sessionId }).catch(() => {})
    return 'permitted'
  } catch (error) {
    return isAgentNotPermitted(error) ? 'denied' : 'unknown'
  }
}
