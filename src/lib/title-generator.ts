/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Generate a chat title from the first message.
 *
 * Keeps the author's own casing — only the first letter is capitalized (sentence
 * case). Title-Casing every word (the old behavior) mangled acronyms, code, and
 * non-Latin scripts (e.g. Russian) and read as shouty; dropping short words
 * garbled the phrase. We now take the leading words verbatim.
 *
 * @param message - The chat message to generate a title from
 * @param options - Optional configuration object
 * @param options.words - Number of words to include in the title (default: 6)
 * @returns A sentence-cased title, or "New Chat" when the message has no usable text
 */
export const generateTitle = (message: string, options?: { words?: number }): string => {
  // Drop a leading conversational opener (English) and collapse whitespace. The
  // opener strip is a no-op for other languages, which simply keep their words.
  const cleaned = message
    .replace(/^\s*(hey|hi|hello|please|can you|could you|help me|what|how|why)\b[\s,]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const maxWords = options?.words ?? 6
  const title = cleaned.split(' ').slice(0, maxWords).join(' ')

  // Truncate to 50 characters at a word boundary so titles stay one line.
  const maxLength = 50
  const truncated =
    title.length > maxLength
      ? (() => {
          const cut = title.slice(0, maxLength)
          const lastSpace = cut.lastIndexOf(' ')
          return lastSpace > 0 ? cut.slice(0, lastSpace) : cut
        })()
      : title

  // Trim only edge punctuation/space — internal apostrophes, hyphens, and the
  // like belong to the words ("don't", "e.g.", "pre-flight").
  const trimmed = truncated.replace(/^[\s.,!?;:'"()[\]{}]+|[\s.,!?;:'"()[\]{}]+$/g, '')

  if (!trimmed) {
    return 'New Chat'
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
