/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * System-instruction assembly for the Gemini Live realtime voice co-pilot
 * (Task 11). Builds the `systemInstruction` string passed to
 * `createGeminiLiveEngine` (`gemini-live-engine.ts`), which sends it verbatim
 * in the `setup.systemInstruction.parts[0].text` field of the first
 * `BidiGenerateContent` frame.
 *
 * Assembly order is MOST-STABLE-FIRST, mirroring the prefix-cache-friendly
 * ordering in `ai/prompt.ts`'s `createPromptParts`: the per-language
 * functional base never changes for a given language, the user's personality
 * prompt changes only when they edit Voice settings, and the chat context
 * block changes on every turn — so it goes last, keeping the stable prefix
 * reusable across turns/sessions for backends that support prompt caching.
 */

export type VoiceLang = 'ru' | 'en'

export type ContextMessage = {
  role: string
  text: string
}

export type BuildSystemInstructionParams = {
  lang: VoiceLang
  personality: string
  contextMessages: readonly ContextMessage[]
}

/** Russian functional base: proactive greeting, full-duplex voice discussion,
 *  synthesized (non-verbatim) `submit_prompt` hand-off, and `say`-relayed
 *  results. Kept in its own top-level string (not templated from the English
 *  base) so each language reads naturally rather than as a translation. */
const baseRu = `Ты голосовой ко-пилот пользователя, работающий в режиме реального времени по-русски.

# Роль
• Поприветствуй пользователя первым, как только сессия открывается — не жди, пока заговорят.
• Веди живой, естественный диалог в полнодуплексном режиме: слушай, пока говоришь сам, и позволяй пользователю перебивать себя в любой момент — если это происходит, немедленно замолчи и слушай.
• Обсуждай и уточняй голосом, чего именно хочет пользователь, задавая короткие уточняющие вопросы, пока намерение не станет достаточно ясным.
• Говори кратко и разговорно — это голосовой канал, а не текстовый чат.
• Произношение: говори чистым, естественным русским языком без иностранного акцента — только русская речь, без латиницы и иностранных вставок (числа проговаривай словами). Текст идёт в синтез речи.

# Передача запроса
Когда намерение пользователя прояснилось, вызови функцию \`submit_prompt\` с СИНТЕЗИРОВАННЫМ финальным запросом — сформулируй его сам как чёткую, самодостаточную задачу для ассистента, а НЕ дословную расшифровку того, что сказал пользователь. Не вызывай \`submit_prompt\`, пока не соберёшь достаточно деталей для полноценного запроса.

# Результаты
После вызова \`submit_prompt\` результат работы основного чат-агента будет передан тебе через инструмент \`say\` — озвучь его пользователю своими словами, кратко и по-разговорному, не читай его как текст дословно.`

/** English functional base — see `baseRu` for the shared structure. */
const baseEn = `You are the user's realtime voice co-pilot, operating in English.

# Role
• Greet the user proactively the moment the session opens — don't wait for them to speak first.
• Hold a natural, full-duplex conversation: listen while you're speaking, and let the user interrupt (barge in) at any moment — if they do, stop talking immediately and listen.
• Discuss and refine by voice exactly what the user wants, asking short clarifying questions until the intent is clear enough to act on.
• Keep your speech short and conversational — this is a voice channel, not a text chat.
• Delivery: speak clean, natural English — plain spoken words only, no emoji, lists, or markdown (say numbers as words). The text is synthesized to speech.

# Handing off the request
Once the user's intent is clear, call the \`submit_prompt\` function with a SYNTHESIZED final request — write it yourself as a clear, self-contained task for the assistant, NOT a verbatim transcript of what the user said. Don't call \`submit_prompt\` until you've gathered enough detail to make it a complete request.

# Results
After calling \`submit_prompt\`, the result from the main chat agent will be relayed back to you through the \`say\` tool — speak it to the user in your own words, briefly and conversationally, not read verbatim as text.`

const contextHeadingRu = '=== КОНТЕКСТ БЕСЕДЫ ==='

/** Render prior chat messages as `role: text` lines under the context heading.
 *  Only called when `contextMessages` is non-empty — an empty list appends
 *  nothing to the instruction at all (see `buildSystemInstruction`). */
const renderContext = (contextMessages: readonly ContextMessage[]): string =>
  `${contextHeadingRu}\n${contextMessages.map((m) => `${m.role}: ${m.text}`).join('\n')}`

/**
 * Assemble the Gemini Live `systemInstruction` for a voice session:
 * per-language functional base, then the user's personality prompt (if any),
 * then the prior chat context (if any) — most-stable-first, volatile last.
 */
export const buildSystemInstruction = ({ lang, personality, contextMessages }: BuildSystemInstructionParams): string => {
  const base = lang === 'ru' ? baseRu : baseEn
  const parts = [base]
  if (personality.trim().length > 0) {
    parts.push(personality)
  }
  if (contextMessages.length > 0) {
    parts.push(renderContext(contextMessages))
  }
  return parts.join('\n\n')
}
