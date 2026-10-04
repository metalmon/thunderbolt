/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { and, eq, isNull } from 'drizzle-orm'
import type { AnyDrizzleDatabase } from '../db/database-interface'
import { modelProfilesTable } from '../db/tables'
import { defaultModelProfiles, hashModelProfile } from '../defaults/model-profiles'
import { clearNullableColumns, nowIso } from '../lib/utils'
import type { ModelProfile, ModelProfileRow } from '../types'

const mapProfile = (row: ModelProfileRow): ModelProfile => row as ModelProfile

/** Get profile for a model (excluding soft-deleted) */
export const getModelProfile = async (db: AnyDrizzleDatabase, modelId: string): Promise<ModelProfile | null> => {
  const profile = await db
    .select()
    .from(modelProfilesTable)
    .where(and(eq(modelProfilesTable.modelId, modelId), isNull(modelProfilesTable.deletedAt)))
    .get()
  return profile ? mapProfile(profile) : null
}

/** Upsert a profile (insert or update, handles soft-deleted rows atomically) */
export const upsertModelProfile = async (
  db: AnyDrizzleDatabase,
  data: Partial<ModelProfile> & Pick<ModelProfile, 'modelId'>,
): Promise<void> => {
  const { defaultHash, ...updateFields } = data as Partial<ModelProfile> & { defaultHash?: string | null }
  await db
    .insert(modelProfilesTable)
    .values(data)
    .onConflictDoUpdate({
      target: modelProfilesTable.modelId,
      set: { ...updateFields, deletedAt: null },
    })
}

/** Create default profile for a model using seed data */
export const createDefaultModelProfile = async (
  db: AnyDrizzleDatabase,
  modelId: string,
  // The bundled profiles are a parameter so this stays testable on a build that
  // ships none: with `defaultModelProfiles` empty the lookup below can only ever
  // miss, and "creates the bundled profile" would have nothing to assert.
  bundled: readonly ModelProfile[] = defaultModelProfiles,
): Promise<void> => {
  const defaultProfile = bundled.find((p) => p.modelId === modelId)
  if (!defaultProfile) {
    return
  }

  await db
    .insert(modelProfilesTable)
    .values({
      ...defaultProfile,
      defaultHash: hashModelProfile(defaultProfile),
    })
    .onConflictDoNothing()
}

/** Soft-delete profile for a model */
export const deleteModelProfileForModel = async (db: AnyDrizzleDatabase, modelId: string): Promise<void> => {
  await db
    .update(modelProfilesTable)
    .set({ ...clearNullableColumns(modelProfilesTable), deletedAt: nowIso() })
    .where(and(eq(modelProfilesTable.modelId, modelId), isNull(modelProfilesTable.deletedAt)))
}

/** Reset a profile to its default values */
export const resetModelProfileToDefault = async (
  db: AnyDrizzleDatabase,
  modelId: string,
  // Same reason as `createDefaultModelProfile`: a build that bundles no profiles
  // can only ever miss this lookup, so the bundle is injectable.
  bundled: readonly ModelProfile[] = defaultModelProfiles,
): Promise<void> => {
  const defaultProfile = bundled.find((p) => p.modelId === modelId)
  if (!defaultProfile) {
    return
  }

  const { defaultHash, ...fields } = defaultProfile as ModelProfile & { defaultHash?: string | null }
  await db
    .update(modelProfilesTable)
    .set({
      ...fields,
      defaultHash: hashModelProfile(defaultProfile),
      deletedAt: null,
    })
    .where(eq(modelProfilesTable.modelId, modelId))
}
