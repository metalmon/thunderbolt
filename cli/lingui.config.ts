/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defineConfig } from '@lingui/cli'
import { formatter } from '@lingui/format-po-gettext'

/**
 * The CLI's own catalogs. Separate config because `lingui compile` has no
 * per-catalog filter, only `--config` — the same reason the backend's email
 * catalogs have one.
 *
 * Two locales, not the app's eight. The app ships every catalog for type
 * compatibility even where nothing is translated; this is an engineering tool
 * for an RU-first closed perimeter, so six empty catalogs would be noise with a
 * maintenance cost (every extract rewrites them) and no reader.
 *
 * `compileNamespace: 'ts'` because there is no Vite here: the binary imports
 * the compiled `messages.ts` directly, exactly as the backend does. Both the
 * `.po` and the compiled `.ts` are committed — nothing in the CLI's build path
 * runs Lingui, so a gitignored catalog is a missing import on a fresh clone.
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'ru'],
  fallbackLocales: {
    default: 'en',
  },
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['src'],
      exclude: ['**/*.test.*', '**/locales/**'],
    },
  ],
  compileNamespace: 'ts',
  // Line numbers would rewrite every catalog whenever an `i18n._` call shifts a
  // line, reddening `i18n:check` for no reason. Same choice as the other two
  // configs in this repo.
  format: formatter({ lineNumbers: false }),
})
