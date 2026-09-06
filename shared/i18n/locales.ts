/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Single source of truth for the locale set, shared by `lingui.config.ts`
 * (extraction/compilation) and the frontend runtime in `src/i18n`. Lives in
 * `shared/` rather than `src/` because the backend validates the
 * `X-App-Language` header against the same list — for the email locale in
 * `backend/src/emails/i18n.ts`, and via {@link matchExactLocale} for the
 * outbound `Accept-Language` in `backend/src/utils/accept-language.ts` — and it
 * cannot import from `src/`. Kept free of runtime imports so the Lingui CLI can
 * load it outside Vite.
 */

/**
 * Locales the app ships catalogs for. `en` is the source locale; `en-XA` is the
 * CI pseudo-locale. Volt keeps upstream's full catalog set here in the TYPE (so
 * upstream code, tests and eval scenarios that name any locale keep compiling and
 * the catalogs stay available), but only OFFERS en/ru to users — see the restricted
 * {@link negotiableLocales} below. `ru` is the fork's one added catalog; the others
 * ride upstream unchanged and are never activated at runtime.
 */
export const appLocales = ['en', 'de', 'fr', 'es', 'pt-BR', 'ja', 'ru', 'en-XA'] as const

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

/**
 * Locales actually OFFERED to users for negotiation and in the language picker.
 * Deliberately narrower than `appLocales`: Volt is a Russian-first product that
 * maintains only the `en` and `ru` catalogs, so this is the set both ends trust —
 * the frontend negotiates `navigator.languages` against it
 * (`src/i18n/resolve-locale.ts`) and the backend validates `X-App-Language` against
 * it. The other catalogs stay shipped (for `appLocales`/type compatibility) but are
 * never activated because nothing negotiates to them. Pinned as an explicit literal,
 * not derived from `appLocales`, precisely so widening the type never silently
 * re-offers de/fr/es/pt-BR/ja.
 */
export const negotiableLocales: readonly AppLocale[] = ['en', 'ru']

/**
 * The shipped locale a client's `X-App-Language` header names, or `null`.
 *
 * Exact (case-insensitive) match, deliberately without the base-language
 * fallback `matchLocale` applies to browser tags: the client sends a tag it has
 * *already* resolved from this set, so anything else is a hand-written header
 * and gets default behaviour rather than a best-effort guess. The pseudo-locale
 * is absent from the set by construction, so a dev build's `en-XA` needs no
 * special case. Callers that forward the result to a third party rely on the
 * return being a member of {@link negotiableLocales} rather than the caller's
 * own string — see `backend/src/utils/accept-language.ts`.
 *
 * @param value Raw header value, or null/undefined when the header is absent.
 * @returns The matching shipped locale, or null.
 */
export const matchExactLocale = (value: string | null | undefined): AppLocale | null => {
  const tag = value?.trim().toLowerCase()
  if (!tag) {
    return null
  }
  return negotiableLocales.find((locale) => locale.toLowerCase() === tag) ?? null
}

/**
 * A locale's language named in English — "German", "Brazilian Portuguese".
 *
 * For model-facing prompt text, so it asks CLDR in `en` rather than in the locale
 * itself (contrast `endonym` in `src/i18n/language-options.ts`, which names each
 * language in itself for the picker). CLDR's exact wording is ICU-version dependent
 * — "Brazilian Portuguese" on one build, "Portuguese (Brazil)" on another — which is
 * fine here and would not be in the UI: the reader is a model, and both name the same
 * language. Don't pin the phrasing in an assertion.
 *
 * The pseudo-locale is named as plain English: CLDR calls it "English
 * (Pseudo-Accents)", which describes the glyph mangling rather than a language to
 * answer in.
 */
export const englishLanguageName = (locale: AppLocale): string =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(locale === pseudoLocale ? sourceLocale : locale) ?? locale
