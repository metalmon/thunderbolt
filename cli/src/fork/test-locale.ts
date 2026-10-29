/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach } from 'bun:test'

/**
 * Pins the CLI's language for the test run.
 *
 * Preloaded by `bunfig.toml`, so it takes effect before any module reads the
 * locale. Without it the suite speaks whichever language the MACHINE is set to:
 * assertions on user-facing text pass on an English CI runner and fail on a
 * Russian workstation, which is the worst shape a test can have — green for
 * whoever added it, red for whoever did not.
 *
 * English because that is the source locale the assertions are written in. A
 * test that wants Russian asks for it explicitly, by passing the locale to
 * `getI18n`.
 */
process.env.VOLT_LANG = 'en'

/**
 * ⚠ And re-pins it BEFORE every test, because the locale is process-wide state.
 *
 * Two different ways it drifts, and this covers both:
 *
 * 1. A test switches it and does not switch back. `applyCliLanguage` is not
 *    only the language picker — the runtime applies the stored preference on
 *    load and on a `set-language` command, so any test building a runtime from
 *    a config carrying `language` changes it for everything after it.
 * 2. The pin above does not take at all on some host, and the run speaks the
 *    machine's language from the first test.
 *
 * Both showed up as the same symptom: one suite asserting `Models` and
 * receiving `Модели` — and with `--randomize`, on one CI architecture but not
 * another, in the same job.
 *
 * `beforeEach`, not `afterEach`: it guarantees the state each test STARTS in,
 * which is what an assertion depends on. Cleaning up afterwards would still
 * leave the first test at the mercy of whatever the environment handed it.
 */
beforeEach(async () => {
  // ⚠ Imported HERE, not at the top. A static import is evaluated BEFORE the
  // assignment above, so `i18n` would resolve its locale from an environment
  // that does not yet carry `VOLT_LANG` — the pin would silently not apply.
  const { i18n } = await import('./i18n.ts')
  i18n.activate('en')
})
