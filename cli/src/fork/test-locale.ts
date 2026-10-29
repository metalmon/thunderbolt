/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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
