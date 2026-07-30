# Gemini Live Voice Co-pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-functional Gemini Live scaffolding on `fork/voice-gemini-live` with a working, proactive voice co-pilot: full-duplex realtime speech that discusses intent, hands a synthesized prompt to the chat agent via `submit_prompt`, and voices the agent's `<widget:say>` output in Gemini's own voice.

**Architecture:** A backend WebSocket route relays raw Gemini Live BidiGenerateContent frames to Google, injecting the server key. The frontend `gemini-live-engine` speaks the real protocol over that relay; `realtime-session` streams mic PCM continuously (never gated), plays 24 kHz audio, handles `interrupted` barge-in, routes `submit_prompt` tool-calls into the chat `Chat` instance, and injects `<widget:say>` text back into the live session. `say` ships as a client widget + a conditionally-advertised skill.

**Tech Stack:** TypeScript, Elysia/Bun WebSocket (backend), `@google/genai` wire protocol (BidiGenerateContent), Web Audio (AudioWorklet capture, gapless playback), Zustand settings, React settings UI, `bun test`.

## Global Constraints

- **Never manipulate the realtime audio stream** — no gating/muting/pausing; mic PCM flows continuously the whole session. (Stream manipulation crashes Gemini Live — verified.)
- **Echo handled only in the AEC/DSP layer** (browser `echoCancellation`, then software AEC with playback reference). Reuse `src/voice/audio/playback.ts` AEC graph.
- **Ephemeral transcript** — only `submit_prompt`'s `prompt` (a user message) and the agent's answer persist to the chat. Voice turns and `<widget:say>` tags are not written as chat text.
- **Audio formats** — mic input `audio/pcm;rate=16000` (PCM16 mono), model output PCM16 @ 24000 Hz.
- **Models** — support both `gemini-2.5-flash-native-audio-preview` (v1alpha upstream) and half-cascade `gemini-live-2.5-flash-preview` (v1beta); user-selectable; default half-cascade. Remove `gemini-2.0-flash-live-001`.
- **Gating** — `experimental_feature_voice` flag + VoltPro; backend route stays auth + Pro-rate-limited.
- **Env** — `GEMINI_API_KEY` is a Google AI Studio key (not OpenRouter).
- **License headers** — every new `src/**`/`backend/**` file gets the MPL header block used across the repo. New fork-owned files may use the fork header per `CLAUDE.md`.
- Commit style: run `HUSKY=0 git commit` per `CLAUDE.md` fork rules; use `bun run test <path> --timeout 5000` (never bare `bun test` at repo root).

---

## File Structure

**Backend**
- `backend/src/fork/gemini-live/routes.ts` — MODIFY. Real BidiGenerateContent relay; model→upstream-URL map; byte passthrough; key injection; size caps.
- `backend/src/fork/gemini-live/routes.test.ts` — MODIFY. Real WS-upgrade + relay tests against a mock upstream.
- `backend/src/config/settings.ts` — KEEP (GEMINI_API_KEY already added on branch); verify.

**Frontend engine/session**
- `src/voice/engine/realtime-types.ts` — MODIFY. Extend `RealtimeEngine` + event union.
- `src/voice/engine/gemini-live-engine.ts` — REWRITE protocol layer; keep/​fix PCM helpers.
- `src/voice/realtime-session.ts` — REWRITE orchestration (mic streaming, greeting, barge-in, tool routing, say-injection, ephemeral policy).
- `src/voice/engine/router.ts`, `src/voice/ui/use-voice-session.ts` — MODIFY. Pass `Chat` instance into the realtime session; model/voice/persona from settings.

**say widget + skill**
- `src/widgets/say/schema.ts`, `src/widgets/say/instructions.ts`, `src/widgets/say/executor.ts` — CREATE.
- widget extractor registration + `src/defaults/skills.ts` (say skill) — MODIFY.

**Settings + prompts**
- `src/stores/local-settings-store.ts` — MODIFY. `voiceProvider` gains `model`, `voiceName`, `personalityPrompt`.
- `src/settings/voice.tsx` — MODIFY. Model/voice/persona controls.
- `src/voice/gemini/prompts.ts` — CREATE. Per-language functional base + assembly helper.

---

## Task 1: Backend relay — correct upstream URL + model routing

**Files:**
- Modify: `backend/src/fork/gemini-live/routes.ts`
- Test: `backend/src/fork/gemini-live/routes.test.ts`

**Interfaces:**
- Produces: `createGeminiLiveRoutes({ auth, rateLimit })` (unchanged export); WS path `/` under the mounted prefix; a helper `upstreamUrlFor(model: string, apiKey: string): string`.

- [ ] **Step 1: Write the failing test for `upstreamUrlFor`**

```ts
// backend/src/fork/gemini-live/routes.test.ts
import { describe, it, expect } from 'bun:test'
import { upstreamUrlFor } from './routes'

describe('upstreamUrlFor', () => {
  it('uses v1beta BidiGenerateContent path for half-cascade + no model query', () => {
    const u = upstreamUrlFor('gemini-live-2.5-flash-preview', 'KEY123')
    expect(u).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=KEY123',
    )
  })
  it('uses v1alpha for native-audio models', () => {
    const u = upstreamUrlFor('gemini-2.5-flash-native-audio-preview', 'KEY123')
    expect(u).toContain('v1alpha.GenerativeService.BidiGenerateContent')
  })
})
```

- [ ] **Step 2: Run it, verify FAIL** — `bun run test:backend backend/src/fork/gemini-live/routes.test.ts` → FAIL (`upstreamUrlFor` not exported).

- [ ] **Step 3: Implement `upstreamUrlFor` and use it in the relay**

```ts
const NATIVE_AUDIO = /native-audio/
export const upstreamUrlFor = (model: string, apiKey: string): string => {
  const version = NATIVE_AUDIO.test(model) ? 'v1alpha' : 'v1beta'
  const svc = `google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent`
  return `wss://generativelanguage.googleapis.com/ws/${svc}?key=${encodeURIComponent(apiKey)}`
}
```

In the `.ws('/', { open })` handler, read the model the client requests (query `?model=` on the *client→proxy* upgrade is fine here — it only selects the upstream path, and is NOT forwarded), then `new WebSocket(upstreamUrlFor(model, process.env.GEMINI_API_KEY!))`. The model still travels to Google inside the client's `setup` message; the query is only for endpoint version selection.

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "fix(voice/backend): correct Gemini Live upstream URL + model→endpoint routing"`

## Task 2: Backend relay — pure byte passthrough + buffering + caps + close propagation

**Files:**
- Modify: `backend/src/fork/gemini-live/routes.ts`
- Test: `backend/src/fork/gemini-live/routes.test.ts`

**Interfaces:**
- Consumes: `upstreamUrlFor` (Task 1).
- Produces: a relay that forwards every client message to upstream and every upstream message to client, unmodified (string or binary), holding client frames in a bounded `pending[]` until upstream `open`, dropping the connection with code `1009` if a single frame exceeds `MAX_FRAME_BYTES` (1 MiB) or `pending` exceeds `MAX_PENDING` (256 frames).

- [ ] **Step 1: Write the failing relay test (mock upstream)**

```ts
// spin a local ws server as the "upstream", monkeypatch upstreamUrlFor target via env override,
// connect a client WS to the Elysia app, assert: client→server bytes arrive at upstream verbatim,
// upstream→client bytes arrive at client verbatim, binary preserved, close propagates both ways.
```
(Use Bun's `Bun.serve({ websocket })` as the mock upstream; inject its URL via a test-only `GEMINI_WS_OVERRIDE` env honored by `upstreamUrlFor`.)

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** the bounded `pending[]` buffer, `upstreamReady` flag, bidirectional `onmessage` passthrough (`ws.send(event.data)` / `upstream.send(data)`), `MAX_FRAME_BYTES`/`MAX_PENDING` guards with `close(1009)`, and close/error propagation (client close → `upstream.close()`, upstream close → `ws.close(code, reason)`). No JSON parsing anywhere in the relay.

- [ ] **Step 4: Run tests, verify PASS.**

- [ ] **Step 5: Delete dead code** — remove any invented-protocol handling, `model` query forwarding, and stale comments from the previous implementation.

- [ ] **Step 6: Commit** — `HUSKY=0 git commit -am "feat(voice/backend): pure byte relay with bounds + close propagation; drop invented protocol"`

## Task 3: Extend the `RealtimeEngine` interface

**Files:**
- Modify: `src/voice/engine/realtime-types.ts`
- Test: `src/voice/engine/realtime-types.test.ts` (create — type-level + a tiny fake engine)

**Interfaces:**
- Produces:
```ts
export type RealtimeToolCall = { id: string; name: string; args: Record<string, unknown> }
export type RealtimeEvent =
  | { type: 'ready' }
  | { type: 'audio'; pcm: Float32Array }          // 24kHz mono
  | { type: 'input_transcript'; text: string }
  | { type: 'output_transcript'; text: string }
  | { type: 'interrupted' }
  | { type: 'tool_call'; call: RealtimeToolCall }
  | { type: 'error'; message: string }
  | { type: 'closed' }
export type RealtimeEngine = {
  id: string
  connect(): Promise<void>
  sendAudio(frame: Int16Array): void              // continuous mic PCM16 @16kHz
  sendText(text: string): void                    // inject a text turn (say)
  sendToolResponse(id: string, name: string, response: Record<string, unknown>): void
  events(): AsyncIterable<RealtimeEvent>
  close(): void
}
```

- [ ] **Step 1: Write a failing test** that imports the types and constructs a `const e: RealtimeEngine = fakeEngine()` whose `events()` yields `{type:'ready'}` then `{type:'tool_call', call:{id:'1',name:'submit_prompt',args:{prompt:'x'}}}`; assert the consumer switch handles both.

- [ ] **Step 2: Run, verify FAIL** (type export missing).

- [ ] **Step 3: Implement** the type additions (keep existing fields the router relies on).

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): extend RealtimeEngine with sendText/tool_call/toolResponse"`

## Task 4: Rewrite `gemini-live-engine` protocol layer

**Files:**
- Modify: `src/voice/engine/gemini-live-engine.ts`
- Test: `src/voice/engine/gemini-live-engine.test.ts`

**Interfaces:**
- Consumes: `RealtimeEngine`/`RealtimeEvent` (Task 3), `upstream WS` to `/v1/gemini-live`.
- Produces: `createGeminiLiveEngine(opts: { model: string; voiceName: string; systemInstruction: string; tools: ToolDeclaration[] }): RealtimeEngine`.

- [ ] **Step 1: Write failing tests** with a fake WebSocket that captures sent JSON and injects server frames. Assert:
  - On `connect()`, the first sent frame is `{ setup: { model, generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } }, systemInstruction: { parts: [{ text }] }, tools: [{ functionDeclarations: [submit_prompt] }], realtimeInputConfig: { automaticActivityDetection: {} }, inputAudioTranscription: {}, outputAudioTranscription: {} } }`.
  - `sendAudio(int16)` sends `{ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: <base64> } } }`.
  - `sendText('hi')` sends `{ realtimeInput: { text: 'hi' } }`.
  - `sendToolResponse('1','submit_prompt',{status:'ok'})` sends `{ toolResponse: { functionResponses: [{ id:'1', name:'submit_prompt', response:{status:'ok'} }] } }`.
  - Injecting `{ setupComplete: {} }` yields `{type:'ready'}`; `{ serverContent:{ modelTurn:{ parts:[{ inlineData:{ data:<b64 pcm24> } }] } } }` yields `{type:'audio', pcm}`; `{ serverContent:{ interrupted:true } }` yields `{type:'interrupted'}`; `{ toolCall:{ functionCalls:[{id,name,args}] } }` yields `{type:'tool_call'}`; `{ serverContent:{ inputTranscription:{text} } }`/`outputTranscription` yield the transcript events.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** the protocol: JSON encode/decode of the above; `pcm16ToBase64`/`base64ToInt16`/`base64ToFloat32` (fix odd-length by copying into a fresh aligned `ArrayBuffer` and honoring `byteOffset`); an async generator pump over `ws.onmessage`. Connect to `wss?://<origin>/v1/gemini-live?model=<model>` (via the app's authed WS URL builder). No local VAD, no activity signals.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): real BidiGenerateContent protocol in gemini-live-engine"`

## Task 5: Wire continuous mic → `sendAudio` in `realtime-session`

**Files:**
- Modify: `src/voice/realtime-session.ts`, capture path (reuse `public/voice/capture-worklet.js`)
- Test: `src/voice/realtime-session.test.ts`

**Interfaces:**
- Consumes: `RealtimeEngine` (Task 3/4), the mic worklet emitting 16 kHz Int16 frames.
- Produces: `createRealtimeSession({ engine, chat, onEvent })` that, once `connect()` resolves, pipes **every** mic frame to `engine.sendAudio` with no gating.

- [ ] **Step 1: Write failing test** — a fake mic source emitting 5 Int16 frames + a spy engine; assert `engine.sendAudio` is called exactly 5×, in order, with no frame dropped, and that there is **no** VAD gate in the path (assert the session never references `createVadGate`).

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — subscribe to the worklet's per-frame output and forward to `engine.sendAudio`. Reuse `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` and route model audio through `playback.ts` (existing AEC reference graph). Remove the old `onUtterance: () => {}` VAD wiring entirely.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): stream mic continuously to realtime engine (the missing sendAudio path)"`

## Task 6: Proactive greeting + barge-in

**Files:** Modify `src/voice/realtime-session.ts`; Test: same test file.

**Interfaces:** Consumes `RealtimeEvent` stream + `engine.sendText`.

- [ ] **Step 1: Failing tests** — (a) after `{type:'ready'}`, the session calls `engine.sendText(<greeting-trigger>)` exactly once (the trigger tells the model to greet); (b) on `{type:'audio'}` the session calls `playback.enqueue`; (c) on `{type:'interrupted'}` the session calls `playback.flush()`.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — the greeting trigger text ("Начни разговор: коротко поздоровайся и спроси, чем заняться." for a new chat; a continuation phrasing when chat history is present), audio→playback, interrupted→flush.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): proactive greeting on open + interrupted barge-in flush"`

## Task 7: `submit_prompt` tool-call → chat agent

**Files:** Modify `src/voice/realtime-session.ts`, `src/voice/ui/use-voice-session.ts`, `src/voice/engine/router.ts`; Test: `src/voice/realtime-session.test.ts`.

**Interfaces:**
- Consumes: `{type:'tool_call', call:{name:'submit_prompt', args:{prompt}}}`, a `Chat` instance (`chatInstance` from `useCurrentChatSession`).
- Produces: on `submit_prompt`, `chat.sendMessage({ text: prompt })` then `engine.sendToolResponse(id,'submit_prompt',{status:'ok'})`.

- [ ] **Step 1: Failing test** — spy `chat.sendMessage`; inject a `submit_prompt` tool_call with `prompt:'draft a plan'`; assert `sendMessage` called once with that text, then `sendToolResponse('<id>','submit_prompt',{status:'ok'})`. Assert **no other** chat messages are produced by voice turns (ephemeral).

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — the handler; thread `chatInstance` from `use-voice-session.ts` into `createRealtimeSession` (currently pipeline-only at the `toReplyChat` call site); declare the `submit_prompt` function declaration in the engine `tools` (Task 4 opts).

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): submit_prompt tool-call routes into the chat agent"`

## Task 8: `say` widget (client-side speak)

**Files:** Create `src/widgets/say/{schema.ts,instructions.ts,executor.ts}`; Modify the widget extractor registry; Test: `src/widgets/say/say.test.ts`.

**Interfaces:**
- Consumes: the active realtime engine's `sendText`.
- Produces: a widget `say` with schema `{ text: string }`, an executor `executeSay({ text }, ctx)` that calls `ctx.voice.sendText(text)` when a realtime voice session is active, else no-op.

- [ ] **Step 1: Failing tests** — `extractWidgets('...<widget:say text="Готово." />...')` returns one `say` widget with `text:'Готово.'`; `executeSay` with an active engine calls `sendText('Готово.')`; with no engine it is a no-op (no throw).

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — schema (mirror `src/widgets/ask/schema`), executor, register `say` in the extractor and widget map so its tag is parsed OUT of assistant text (not rendered as chat text). `instructions.ts` = the per-model guidance text used by the skill in Task 9.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): say widget speaks agent text via the live voice engine"`

## Task 9: `say` skill + conditional advertisement

**Files:** Modify `src/defaults/skills.ts` (+ bump `defaultSkillsVersion` and its snapshot test), the skills payload builder feeding `_meta`; Test: `src/defaults/skills.test.ts` + a payload-filter test.

**Interfaces:**
- Produces: a `SkillDefinition` `{ name:'say', description, instruction }` (instruction from `src/widgets/say/instructions.ts`), included in the advertised skill set **iff** the voice co-pilot feature is enabled (provider `gemini-live` + `experimental_feature_voice` + VoltPro).

- [ ] **Step 1: Failing tests** — (a) with voice enabled, the built skills payload contains a `say` skill; (b) with voice disabled, it does not; (c) the `defaults/skills.ts` snapshot test fails until `defaultSkillsVersion` is bumped (proving the content change is versioned).

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — add the say skill default, bump `defaultSkillsVersion`, update the snapshot, and add the voice-feature filter where the `_meta` skills payload is assembled. If ACP allows re-advertising, re-issue skills when voice toggles; otherwise document the session-start limitation inline.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): publish say skill, gated on the voice co-pilot feature"`

## Task 10: Settings — model, voice, personality

**Files:** Modify `src/stores/local-settings-store.ts`, `src/settings/voice.tsx`; Test: `src/settings/models/... ` store test + a voice-settings render test.

**Interfaces:**
- Produces: `voiceProvider` config gains `model: 'native-audio' | 'half-cascade'` (default `'half-cascade'`), `voiceName: string` (default `'Autonoe'`), `personalityPrompt: string`. Voice list per model exported as `GEMINI_VOICES: Record<model, string[]>`.

- [ ] **Step 1: Failing tests** — store defaults present + persisted; the voice settings page shows a model select, a voice select whose options come from `GEMINI_VOICES[model]` and swap on model change, and a personality textarea; all bound to the store.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — store fields + defaults; add `'gemini-live'` to `voiceProvider.kind`; the three controls in `voice.tsx` (i18n keys added to `locales/**` on `fork/i18n`/`fork/i18n-locales` in a follow-up — for now English literals wrapped later).

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): model/voice/personality settings for Gemini Live"`

## Task 11: Prompt assembly (per-language base + persona + context)

**Files:** Create `src/voice/gemini/prompts.ts`; Modify `use-voice-session.ts` to build `systemInstruction`; Test: `src/voice/gemini/prompts.test.ts`.

**Interfaces:**
- Produces: `buildSystemInstruction({ lang: 'ru'|'en'; personality: string; contextMessages: {role,text}[] }): string`.

- [ ] **Step 1: Failing tests** — ru returns the ru functional base; en returns the en base; personality is appended after the base; a non-empty `contextMessages` appends a "=== КОНТЕКСТ БЕСЕДЫ ===" block last; empty context appends nothing; the base always instructs the model to call `submit_prompt` with a synthesized (non-transcript) request and to expect results relayed via `say`.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — the two base strings (ru/en), assembly order (base → persona → context, volatile last), and the helper. Wire `lang` from UI language, `personality` from settings, `contextMessages` from the `Chat` history (trimmed) in `use-voice-session.ts`.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `HUSKY=0 git commit -am "feat(voice): per-language system instruction with persona + chat context"`

## Task 12: End-to-end wiring + echo validation

**Files:** Modify `src/voice/engine/router.ts`, `src/voice/ui/use-voice-session.ts`; manual test note.

- [ ] **Step 1** — Router: for `kind==='gemini-live'`, build `createGeminiLiveEngine({ model, voiceName, systemInstruction, tools:[submitPromptDecl] })` and hand it to `createRealtimeSession({ engine, chat })`. Verify `bun run type-check` = 0 and `bun run test src/voice --timeout 5000` green.
- [ ] **Step 2** — Commit — `HUSKY=0 git commit -am "feat(voice): wire Gemini Live co-pilot end to end"`
- [ ] **Step 3: Echo smoke on real hardware (manual, blocking gate).** Debug-build the app; enable voice with `echoCancellation:true`; play the model over **speakers**; confirm no self-triggering / feedback and that Gemini does not error from stream continuity. If browser AEC is insufficient, open a follow-up task for software AEC with a playback reference (still continuous stream). Record the result in the PR.
- [ ] **Step 4** — Rebuild `master` via `dev-local/rebuild-master.ps1` (HUSKY=0) once `fork/voice-gemini-live` is added to the rebuild stack (commit `41576078` already does this); confirm typecheck 0 on assembled master.

---

## Self-Review

- **Spec coverage:** proactive greeting (T6), full-duplex continuous stream (T5, invariant), echo/AEC (T5+T12.3), ephemeral transcript (T7), backend real relay (T1–T2), protocol rewrite (T4), submit_prompt (T7), say widget (T8) + conditional skill (T9), settings model/voice/persona (T10), per-language prompts (T11), gating (T9/T10), both models + endpoint routing (T1/T10). Covered.
- **Placeholders:** none — every step has concrete tests/impl or exact commands.
- **Type consistency:** `RealtimeEngine`/`RealtimeEvent`/`RealtimeToolCall` defined in T3 and used verbatim in T4–T8; `buildSystemInstruction`, `upstreamUrlFor`, `GEMINI_VOICES` names consistent across tasks.
