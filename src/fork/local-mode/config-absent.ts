/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useConfigStore } from '@/api/config-store'

/**
 * Declare that there is no deployment config, without asking for one.
 *
 * Every `/config`-derived predicate already reads an absent config as a sensible
 * default (upstream calls this "standalone mode"), but `configLoaded` is NOT
 * persisted — so a local-mode boot starts with `configLoaded: false` and an empty
 * config, which `selectConfigSettled` reads as "still waiting". The
 * deployment-gated controls would then never appear. Saying "absent, AND
 * settled" is the whole fix.
 *
 * Its own leaf module on purpose: both the boot path (`src/api/config.ts`, step 0
 * of initialization) and the mode switch need it, and the switch pulls in
 * PowerSync's sync-state — which has no business being imported during boot.
 */
export const markConfigAbsent = () => useConfigStore.setState({ config: {}, configLoaded: true })
