/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Whether a segment from `Intl.Segmenter` should be kept as a searchable word.
 *
 * `isWordLike` alone is not portable. UAX #29 counts digits as word-like, and
 * Chromium agrees — but Bun's ICU reports `isWordLike: false` for a pure-digit
 * run, so `100%の確率` loses `100` entirely there: it reaches neither the MATCH
 * side nor the substring side, and the user gets results for `確率` alone with
 * nothing to say a term was dropped. Measured on both engines for that exact
 * query before this existed.
 *
 * Silently losing a term is the worst outcome a query planner has, and which
 * engine the app happens to run on must not decide it. So the rule is ours:
 * keep what the engine calls word-like, and keep anything carrying a letter or
 * a number whatever it says. Punctuation and whitespace still fall away, which
 * is all the filter was ever for.
 *
 * @param part - one segment from `Intl.Segmenter.prototype.segment`
 */
export const isSearchableSegment = (part: { segment: string; isWordLike?: boolean }): boolean =>
  part.isWordLike === true || /[\p{L}\p{N}]/u.test(part.segment)
