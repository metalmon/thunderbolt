/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt). Do not upstream. */

/**
 * Fork: the standalone Thunderbolt/Volt CLI is not distributed inside the
 * closed perimeter, so its install row is hidden everywhere. Upstream renders
 * the row always on web and conditionally on desktop (by published-binary
 * availability); the fork collapses both to hidden.
 *
 * Kept as a predicate so the seam in the upstream row component is a single
 * import + one call, per the fork thin-hook rule.
 */
export const forkHideCliRow = (): boolean => true
