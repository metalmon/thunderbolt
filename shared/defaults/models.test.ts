/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { defaultModels, defaultModelsVersion, hashModel } from './models'

/**
 * Snapshot pinning the shipped defaults to their declared version. When you
 * change any default model (add/remove/edit/reorder), this test fails.
 *
 * Fix it in this order:
 *   1. Bump `defaultModelsVersion` in `shared/defaults/models.ts`.
 *   2. Update `expected` below to match the actual values from the failure.
 *
 * The version is the ordering signal reconcile uses to decide who owns the
 * newest defaults across devices (THU-637). Changing defaults without bumping
 * the version breaks that ordering silently.
 */
const computeSnapshotHash = () =>
  defaultModels.map((model, index) => `${index}:${model.id}:${hashModel(model)}`).join('|')

const expected = {
  version: 3,
  hash: '0:38e10634-2fbc-4323-b86d-3a5a6c0ca824:-q1ptfc|1:d30990db-4d18-4713-8b08-ca8cabd206bb:mzov96|2:8a86bbe0-42a2-444c-aacf-7a8448262bb4:-shqsj1|3:b4db7251-0475-45bb-8dfa-05dbbaa961ca:-87f1eu',
}

describe('defaultModels version snapshot', () => {
  test('version and content are in sync — read the file header if this fails', () => {
    expect({
      version: defaultModelsVersion,
      hash: computeSnapshotHash(),
    }).toEqual(expected)
  })
})
