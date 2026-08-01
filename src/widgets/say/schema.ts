/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createParser } from '@/lib/create-parser'
import { z } from 'zod'

/**
 * Zod schema for the `say` widget. Unlike every other widget, `say` has no
 * visual presentation — it's a client-side instruction to speak `text` aloud
 * through the active realtime voice engine (see `executor.ts`). Emitting it
 * removes the tag from the rendered assistant text (handled generically by
 * the widget extractor) so it never shows up as chat prose.
 */
export const schema = z.object({
  widget: z.literal('say'),
  args: z.object({
    text: z.string().min(1),
  }),
})

export type SayWidget = z.infer<typeof schema>

/** Parse function — auto-generated from schema. */
export const parse = createParser(schema)
