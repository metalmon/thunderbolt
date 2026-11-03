/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork IP — additive. Not upstream MPL logic; a thin fork-only helper. */

import { eq } from 'drizzle-orm'
import { getDb } from '@/db/database'
import { agentsTable } from '@/db/tables'
import type { AnyDrizzleDatabase } from '@/db/database-interface'
import { localAgentOwnerId } from './agent-owner'

/** What this needs from the auth client, structurally — so this file stays free of
 *  auth imports and the test needs no client. */
export type SessionReader = {
  getSession: () => Promise<{ data?: { user?: { id?: string } | null } | null } | null>
}

/**
 * Hand the agents created on this device while autonomous to the account that just
 * signed in, and report how many moved.
 *
 * Switching to a server deployment offers "keep local data", and that is a promise:
 * rows carrying {@link localAgentOwnerId} must become the signing-in account's, or they
 * stay outside every owner-scoped read and the kept data is invisible.
 *
 * The rule is **the first account to sign in takes them**. Only marked rows move, so
 * after that first sign-in no mark is left and a second account finds nothing to
 * inherit — it meets the ordinary owner scope instead. Rows carrying another account's
 * real id are never touched.
 *
 * Idempotent by construction: re-auth after a session expiry runs this again and the
 * second pass matches nothing.
 */
export const adoptLocalAgents = async (db: AnyDrizzleDatabase, newOwnerId: string): Promise<number> => {
  if (!newOwnerId || newOwnerId === localAgentOwnerId) {
    return 0
  }
  const marked = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, localAgentOwnerId))
  if (marked.length === 0) {
    return 0
  }
  await db.update(agentsTable).set({ userId: newOwnerId }).where(eq(agentsTable.userId, localAgentOwnerId))
  return marked.length
}

/**
 * The sign-in seam: resolve who just signed in, then adopt.
 *
 * Reads the session from the client rather than taking an id, because the caller sits
 * in the sign-in success path where the rendered session is still the pre-sign-in one.
 *
 * ⚠ Deliberately swallows its own failure, against the repo's preference for loud
 * errors. It runs immediately before `setSyncEnabled(true)`, inside the one promise
 * that enables sync; a throw here would leave sync off, and an account with sync off is
 * a far worse outcome than an agent that stayed marked and can be adopted on the next
 * sign-in.
 */
export const adoptLocalAgentsOnSignIn = async (client: SessionReader): Promise<void> => {
  try {
    const session = await client.getSession()
    const newOwnerId = session?.data?.user?.id
    if (!newOwnerId) {
      return
    }
    const adopted = await adoptLocalAgents(getDb(), newOwnerId)
    if (adopted > 0) {
      console.info(`[agents] adopted ${adopted} local-mode agent(s) into the signed-in account`)
    }
  } catch (error) {
    console.warn('[agents] could not adopt local-mode agents on sign-in:', error)
  }
}
