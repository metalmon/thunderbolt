/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Single source of truth for the locale set, shared by `lingui.config.ts`
 * (extraction/compilation) and the frontend runtime in `src/i18n`. Lives in
 * `shared/` rather than `src/` so that the backend can validate the
 * `X-App-Language` header against the same list once it starts reading it — it
 * cannot import from `src/`. Kept free of runtime imports so the Lingui CLI can
 * load it outside Vite.
 */

/**
 * Locales the app ships catalogs for. `en` is the source locale; `en-XA` is the
 * CI pseudo-locale. Volt is a Russian-first product, so upstream's broader locale
 * set (de/fr/es/pt-BR/ja) is trimmed to just the source plus Russian — the only
 * two catalogs we actually maintain — keeping extraction, bundle chunks, and the
 * brand override surface minimal.
 */
export const appLocales = ['en', 'ru', 'en-XA'] as const

export type AppLocale = (typeof appLocales)[number]

export const sourceLocale: AppLocale = 'en'

/**
 * The locale the UI falls back to when no explicit `language` setting and no
 * browser-language match applies. Russian, because Volt ships Russian-first;
 * an English browser still resolves to `en` through negotiation, and the picker
 * lets anyone switch.
 */
export const defaultLocale: AppLocale = 'ru'

export const pseudoLocale: AppLocale = 'en-XA'
