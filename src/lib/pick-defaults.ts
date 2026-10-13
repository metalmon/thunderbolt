/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  defaultModelImageSupport,
  defaultModels,
  defaultModelsVersion,
  type ImageSupport,
  type SharedModel,
} from '@shared/defaults/models'

export type ModelsDefaults = {
  version: number
  data: readonly SharedModel[]
  imageSupport: Readonly<Record<string, ImageSupport>>
}

type ServerModelsDefaults = { version: number; data: SharedModel[]; imageSupport?: Record<string, ImageSupport> }

/**
 * Pick between server-supplied and bundled models defaults, preferring the
 * higher declared version. Behaves like an OTA channel: the server can hot-ship
 * new defaults without a client build; when offline / unreachable / behind, the
 * bundle wins.
 *
 * Rollback semantics are monotonic — a server that regresses its declared
 * version below what the client already has will not overwrite. To retract a
 * bad server-published set, ship a *higher* version with the reverted content.
 *
 * Sanity guards on the server payload (fall back to bundle when tripped):
 *   - version is a finite number strictly higher than the bundle's;
 *   - `data` is a non-empty array;
 *   - **at least one id in `data` overlaps with the bundle's `defaultModels`**,
 *     *when the bundle ships any*. Without it, `cleanupRemovedDefaults` would
 *     treat every bundle-known row as retired (none appear in the server's
 *     `currentModelIds`) and soft-delete the lot. Bundle acts as the floor: OTA
 *     can update or retire ids the bundle knows, but not wipe wholesale.
 *
 *     A build that ships NO bundled models (this fork — its lineup is a
 *     deployment decision, so the server supplies it) has no such rows to
 *     protect, and an overlap test against an empty set rejects every payload.
 *     The guard is therefore conditioned on the bundle being non-empty, which
 *     is what keeps the channel usable for a pilot that publishes its own set.
 *     Upstream behaviour is unchanged: with a non-empty bundle the rule applies
 *     exactly as before.
 */
export const pickModelsDefaults = (
  server: ServerModelsDefaults | undefined,
  // The bundle is a parameter so the rules below stay testable on a fork that
  // ships none: with `defaultModels` empty the overlap guard can never be
  // satisfied by any payload, and its tests would have nothing to assert against.
  bundle: { version: number; data: readonly SharedModel[] } = {
    version: defaultModelsVersion,
    data: defaultModels,
  },
): ModelsDefaults => {
  if (
    server &&
    Number.isFinite(server.version) &&
    server.version > bundle.version &&
    Array.isArray(server.data) &&
    server.data.length > 0
  ) {
    const bundledIds = new Set(bundle.data.map((m) => m.id))
    // An EMPTY bundle (this fork ships no models) makes the overlap rule
    // meaningless rather than strict: there is no bundle-known row for
    // `cleanupRemovedDefaults` to retire and no local state a payload could wipe,
    // so demanding an overlap would reject every well-formed payload and leave the
    // deployment with no models at all. Overlap is required only when there IS a
    // bundle to protect.
    if (bundledIds.size === 0 || server.data.some((m) => bundledIds.has(m.id))) {
      // Backends that predate the map omit it; its models then fall back to the generic rules and detection.
      return { version: server.version, data: server.data, imageSupport: server.imageSupport ?? {} }
    }
    // Payload is well-formed but has zero overlap with the bundle. Either the
    // server team shipped a wholesale replacement (needs a client build with
    // matching profiles first) or the payload is misconfigured. Either way,
    // adopting it would wipe local state — fall back to bundle and log.
    console.warn(
      `[pickModelsDefaults] Server payload rejected: ${server.data.length} model id(s) with zero overlap ` +
        `against the ${bundle.data.length} bundled defaults. Falling back to the bundled lineup.`,
    )
  }
  return { version: bundle.version, data: bundle.data, imageSupport: defaultModelImageSupport }
}
