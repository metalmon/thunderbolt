/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createModel, getModel } from '@/dal/models'
import type { AnyDrizzleDatabase } from '@/db/database-interface'
import type { SharedModel } from '@shared/defaults/models'

/**
 * Put the eval matrix's reference models in the eval's own database.
 *
 * `scenarios.ts` points the matrix at reference models "rather than the shipped
 * defaults, so swapping the picker catalog never breaks the eval matrix" — but the
 * runner then resolves each one through `getModel` against a database seeded only
 * from `defaultModels`, and this fork trimmed that to a single free-tier entry. So
 * the intent was defeated at runtime: every run died with "Eval model missing: glm"
 * before it had planned anything, and the scenario matrix knows nothing about the
 * one model that IS seeded.
 *
 * Seeding them here closes the loop without touching what the product ships.
 * Existing rows are left alone, so a real catalog entry always wins.
 *
 * @param db - the eval's database (in-memory, from `setupTestDatabase`)
 * @param models - the matrix's reference models
 */
export const seedEvalReferenceModels = async (db: AnyDrizzleDatabase, models: ReadonlyArray<SharedModel>) => {
  for (const model of models) {
    if (await getModel(db, model.id)) {
      continue
    }
    await createModel(db, model)
  }
}
