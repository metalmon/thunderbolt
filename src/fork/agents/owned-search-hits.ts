/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork IP — additive. Not upstream MPL logic; a thin fork-only helper. */

import type { SearchResult } from '@/search/types'

/**
 * Drop search hits for custom agents that are not the current user's.
 *
 * The full-text index is filled by SQLite triggers over the whole `agents`
 * table (`src/search/fts-setup.ts`), which knows about deletion but not about
 * ownership. The local database outlives sign-outs, so on a shared device the
 * index still carries the names and descriptions of another user's agents —
 * and the palette would happily show them, and route to a settings page where
 * the row is (correctly) invisible.
 *
 * Only agent hits are filtered: every other entity type is already scoped
 * elsewhere, and dropping unknown types here would silently empty the palette.
 *
 * @param results  hits as they come out of the index
 * @param ownedAgentIds  ids of the current owner's custom agents
 */
export const dropForeignAgentHits = (results: SearchResult[], ownedAgentIds: ReadonlySet<string>): SearchResult[] =>
  results.filter((hit) => hit.entityType !== 'agent' || ownedAgentIds.has(hit.id))
