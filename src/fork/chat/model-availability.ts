/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEffect, useState } from 'react'

import { useDatabase } from '@/contexts'
import { getAvailableModels } from '@/dal'

/**
 * Whether this installation has any model at all to chat with.
 *
 * Upstream assumes at least one always exists, because its catalog seeds one;
 * `getSelectedModel` throws `No system model found` when the table is empty, which takes
 * `hydrateChatStore` down with it and leaves the chat pane rendering nothing — a black
 * screen with a working sidebar. The fork ships an EMPTY catalog on purpose (a closed
 * perimeter cannot reach the cloud model upstream defaults to), so that assumption does
 * not hold here and the app has to say so instead of breaking.
 *
 * Checked rather than inferred from a caught error: the throw happens inside a
 * `Promise.all` alongside six other reads, so catching it there would also swallow a
 * genuine database failure and show the operator the wrong explanation.
 */
export type ModelAvailability = 'checking' | 'none' | 'present'

/**
 * Reads the model table once per mount.
 *
 * @returns 'checking' until the first read lands, then whether any model exists
 */
export const useModelAvailability = (): ModelAvailability => {
  const db = useDatabase()
  const [availability, setAvailability] = useState<ModelAvailability>('checking')

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const models = await getAvailableModels(db)
      if (!cancelled) setAvailability(models.length > 0 ? 'present' : 'none')
    }
    // A failed read is not "no models": leave it 'checking' so the caller keeps its
    // loading state rather than telling the operator to add a model he may already have.
    check().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [db])

  return availability
}
