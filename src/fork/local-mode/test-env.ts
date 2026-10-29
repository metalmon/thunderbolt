/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork: names the operation mode the suite runs in, instead of letting it be
 * decided by an environment variable that is absent.
 *
 * `operationMode` defaults to `'server'` when `VITE_THUNDERBOLT_CLOUD_URL` is
 * set and `'local'` when it is not (`src/stores/local-settings-store.ts`). The
 * frontend runner starts with `--cwd=src`, so Bun loads `src/.env` — which does
 * not exist — rather than the repo root's, and the variable is therefore unset.
 * The whole suite then ran in LOCAL mode: `getSelectedModel` threw "No system
 * model found" because the managed lane is hidden there, `composeAllAgents`
 * dropped the system agents, and `useAuthGate` returned `allowed` before it
 * could redirect — 93 failures that looked like broken code and vanished when a
 * file was run alone from the repo root, where `.env` IS loaded.
 *
 * ⚠ Worse than the red tests: server mode — the shipped default — was not being
 * exercised by anything, locally or in CI.
 *
 * Setting the variable rather than poking the store on purpose: the suite then
 * takes the same derivation a real build takes. Local-mode tests set the store
 * explicitly in their own `beforeEach`, so they are unaffected.
 */
process.env.VITE_THUNDERBOLT_CLOUD_URL ??= 'https://api.test.invalid/v1'
