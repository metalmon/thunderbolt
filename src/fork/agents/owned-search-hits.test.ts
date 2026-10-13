/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork IP — additive. Not upstream MPL logic; a thin fork-only helper. */

import { describe, expect, it } from 'bun:test'
import type { SearchResult } from '@/search/types'
import { dropForeignAgentHits } from './owned-search-hits'

const hit = (id: string, entityType: SearchResult['entityType']): SearchResult => ({
  id,
  entityType,
  title: `${entityType} ${id}`,
  snippet: '',
  to: '/',
})

describe('dropForeignAgentHits', () => {
  it('keeps the owner agents and drops the ones that belong to someone else', () => {
    const results = [hit('a-mine', 'agent'), hit('a-theirs', 'agent')]

    expect(dropForeignAgentHits(results, new Set(['a-mine'])).map((r) => r.id)).toEqual(['a-mine'])
  })

  it('drops every agent hit when nobody is signed in', () => {
    expect(dropForeignAgentHits([hit('a-mine', 'agent')], new Set())).toEqual([])
  })

  it('leaves other entity types alone', () => {
    const results = [hit('c-1', 'chat'), hit('a-theirs', 'agent'), hit('m-1', 'message')]

    expect(dropForeignAgentHits(results, new Set()).map((r) => r.id)).toEqual(['c-1', 'm-1'])
  })
})
