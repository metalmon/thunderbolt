/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getDefaultModelForThread } from '@/dal'
import type { AnyDrizzleDatabase } from '@/db/database-interface'
import type { Model } from '@/types'

/**
 * The model a thread should open with, or null when this installation has none.
 *
 * A local model is only needed by the BUILT-IN agent: a voltd agent carries its own, and
 * blocking the chat for a missing local model would also block the agents that do not
 * need one. Upstream cannot express that — its catalog always seeds a model, so
 * `getSelectedModel` treats an empty table as an error and throws.
 *
 * Narrow on purpose: only the "no model at all" case becomes null. Anything else — a
 * broken database, a corrupt row — still throws, because a chat that silently opens
 * model-less on a real failure is harder to diagnose than one that fails loudly.
 */
export const resolveThreadModel = async (
  db: AnyDrizzleDatabase,
  threadId: string,
  fallbackModelId?: string,
): Promise<Model | null> => {
  try {
    return await getDefaultModelForThread(db, threadId, fallbackModelId)
  } catch (error) {
    if (error instanceof Error && error.message === 'No system model found') return null
    throw error
  }
}
