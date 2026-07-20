/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Always prepended to ACP user prompts (composeAcpPrompt). Keep this short and
 * unambiguous — models otherwise invent markdown footnote form `[N]:uri`, which
 * renders as a DOCX badge plus raw `:attachment://…` text.
 */
export const ZEROCLAW_DELIVER_CITE_NOTE = `After deliver_file returns uri=attachment://deliver/…, cite the file in ONE of these forms only:
1) <widget:document-result fileId="<exact uri>" name="<pretty from [Document: …]>" />
2) bare [N] where N is the 1-based delivery order in this turn (example: See [1].)
Never write [N]:uri, never paste a bare attachment:// URL, never invent fileId prefixes.
Pretty names come from [Document: …], never from the uri basename alone when a Document marker exists.`
