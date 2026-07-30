# Gemini Live Voice Co-pilot — Design Spec

**Status:** agreed design, 2026-07-30
**Branch:** `fork/voice-gemini-live`
**Supersedes:** the previous plan `docs/superpowers/plans/2026-07-30-gemini-live-voice-engine.md`
(non-functional: invented protocol, mic never streamed, no tools/proactivity).

## 0. One-paragraph summary

A **proactive, collaborative voice co-pilot** built on Google Gemini Live (bidi
WebSocket), gated behind VoltPro. Unlike ordinary voice (transcribe my words →
answer → speak), Gemini holds a real spoken conversation to *refine intent*.
When the intent is clear it calls one function, `submit_prompt(prompt)`, whose
argument — the **synthesized result of the discussion, not a transcript** — is
sent to the normal chat agent (gost) as a user message. The agent answers in the
chat and can speak back by emitting a `<widget:say text="…">` tag, which the
client extracts and voices **in Gemini's own voice** (unified voice channel). The
voice discussion itself is ephemeral: only `submit_prompt`'s prompt and the
agent's chat answer land in the conversation.

## 1. Interaction model

- Entry: the existing mic button. Provider **"Gemini Live"** selected in Voice
  settings. Same UI as pipeline voice (button + `voice-waveform`).
- **Proactive greeting** on session open — Gemini speaks first (no user turn
  needed): new chat → "привет, чем займёмся?"; existing chat → it has the chat
  history as context and opens with a continuation ("вижу, обсуждали X — …").
- **Full duplex, realtime** (NOT push-to-talk). Continuous listening + speaking.
  Turn detection & barge-in are **server-side** (Gemini `automaticActivityDetection`
  + `interrupted` events). No local VAD on the realtime path.
- Discuss the task by voice. When ready, Gemini calls **`submit_prompt({prompt})`**
  → `prompt` becomes a normal user message to the chat agent → agent works, answer
  streams into the chat.
- The agent voices what it chooses via **`<widget:say text="…">`** → client extracts
  → injected into the live Gemini session (`sendText`) → Gemini reads it aloud.
- Loop continues within the one voice session (the Gemini session lives for the
  whole voice-mode session); each `submit_prompt` produces a chat exchange.

## 2. Hard invariants (battle-tested constraints)

1. **Never manipulate the realtime audio stream.** No gating, muting, pausing, or
   "stop sending while our own speech plays." Confirmed: any stream manipulation
   makes Gemini Live error out. Mic → 16 kHz PCM must flow **continuously** the
   entire session.
2. **Echo is solved only in the AEC/DSP layer**, never by touching the stream.
   Primary: browser `getUserMedia({ echoCancellation: true })` (reuse the existing
   pipeline's AEC graph in `src/voice/audio/playback.ts` — playback routed through
   analyser→destination as echo reference). If loud speakers defeat browser AEC:
   add software AEC that subtracts the known playback signal from the mic — still a
   continuous, cleaned stream. Last resort: headphones. **Validate on real hardware
   first — this is the #1 risk.**
3. **Ephemeral transcript.** Only `submit_prompt`'s prompt (as a user message) and
   the agent's chat answer are persisted to the conversation. The spoken
   back-and-forth and `<widget:say>` tags are not written as chat text (say tags
   are extracted out).

## 3. Architecture — reuse the scaffolding on `fork/voice-gemini-live`, rewrite the load-bearing parts

The existing branch has the right *shape* but three broken/absent mechanisms
(invalid proxy URL, invented wire protocol, mic never sent, no tools/proactivity).
Verdict per component:

| Component | File | Action |
|---|---|---|
| Backend WS proxy | `backend/src/fork/gemini-live/routes.ts` | **Fix + keep.** Dual-WS bridge structure is correct. Fix upstream URL to `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent` (v1alpha for native-audio); drop the `&model=` query param (model goes in the client's `setup`). Keep it a **dumb byte passthrough** that only injects `?key=GEMINI_API_KEY`. Add message-size caps + bounded pending buffer. **Remove the dead/invented protocol assumptions.** Real WS-upgrade tests. |
| Realtime engine interface | `src/voice/engine/realtime-types.ts` | **Extend.** Add: `sendText(text)` (say-injection), `toolCall` event variant, `sendToolResponse(...)`. (No `activityStart/End` — full-duplex/server-VAD.) |
| Gemini client engine | `src/voice/engine/gemini-live-engine.ts` | **Rewrite the protocol layer** to real BidiGenerateContent: `setup{ model, generationConfig{responseModalities:["AUDIO"], speechConfig{voiceConfig}}, systemInstruction, tools:[submit_prompt], realtimeInputConfig{automaticActivityDetection:{}}, inputAudioTranscription:{}, outputAudioTranscription:{} }`; `realtimeInput.audio` (continuous); parse `setupComplete`, `serverContent.modelTurn/inputTranscription/outputTranscription/interrupted`, `toolCall`; send `toolResponse`. Keep PCM/base64 helpers (fix odd-length/`byteOffset` alignment) and the async-iterator event pump. Model configurable. |
| Realtime session orchestration | `src/voice/realtime-session.ts` | **Rewrite.** Wire the **missing** mic→`sendAudio` continuous path (the core bug). Proactive greeting on open. `interrupted` → `playback.flush()` (barge-in). `toolCall(submit_prompt)` → `chatInstance.sendMessage(prompt)`. Inbound `say` (from widget executor) → `engine.sendText`. Ephemeral-transcript policy. |
| Router / session start | `src/voice/engine/router.ts`, `src/voice/ui/use-voice-session.ts` | **Keep + wire.** Pass the chat `Chat` instance into the realtime session (currently pipeline-only) so `submit_prompt`/`say` reach the chat. |
| Settings + gating | `src/settings/voice.tsx`, `src/stores/local-settings-store.ts` | **Extend** (see §5). Gate stays `experimental_feature_voice` + VoltPro (backend already Pro-rate-limited + auth). |
| `say` widget | `src/widgets/say/{schema,instructions,executor}` + extractor + skill defaults | **New**, per the ACP contract (§4). |

## 4. Tools & the `say` widget (per the ACP Widget-Skill Contract)

Two distinct mechanisms — do not conflate:

- **`submit_prompt` — a native Gemini Live function call** (Gemini → client only;
  not ACP). Declared in the engine `setup.tools`. Schema:
  `submit_prompt({ prompt: string })` — "the finalized request to the model,
  synthesized from the discussion (not a verbatim transcript)". Handler:
  `chatInstance.sendMessage(prompt)`. Then send a `toolResponse` ack so Gemini can
  continue.
- **`say` — an ACP client widget, NOT an agent tool** (per
  `E:/zeroclaw/.../2026-07-30-acp-widget-skill-contract.md`). The chat agent emits
  `<widget:say text="…" />` inside its normal assistant text; the client's existing
  widget extractor pulls it out and the `say` executor speaks it via the active
  voice engine → `engine.sendText(text)` → Gemini voices it. Fire-and-forget, no
  agent→client RPC, no MCP, no fork-seam.

  `say` is therefore **two artifacts**: (a) the client **widget**
  (`src/widgets/say/{schema,instructions,executor}` + extractor registration), and
  (b) a published **skill** — an instruction-only `SkillDefinition` teaching the
  model when/how to emit `<widget:say>` (model on `defaultSkillAsk` +
  `src/widgets/ask/instructions.ts`), advertised over the `_meta` skills payload.
  ZeroClaw guarantees byte-for-byte passthrough of the tag.

  **Conditional advertisement (required):** the `say` skill is included in the
  session `_meta` skills payload **only when the voice co-pilot feature is
  enabled** (provider = `gemini-live` + `experimental_feature_voice` + VoltPro).
  When voice is disabled the skill is **omitted**, so the agent is never told to
  emit `<widget:say>` (which would otherwise be spoken to nowhere). Implementation:
  filter the default-skills set by voice-feature state when building the payload.
  **Open item:** voice mode can toggle mid-chat; skills are normally sent at
  `session/new|resume|load`. Decide whether toggling voice re-advertises the skill
  set (re-issue skills / `session/resume`) or whether say-availability is fixed at
  session start. Prefer re-advertising on toggle if the ACP layer allows it.

Note: `say` is generic — when no realtime voice engine is active, its executor is a
no-op (or later, pipeline TTS). In this feature it targets the live Gemini session.

## 5. Settings surface (Voice → Gemini Live)

Persisted in the voice-provider config (`local-settings-store.ts`), read by the
engine at `setup`:

- **provider kind**: add `'gemini-live'` to `voiceProvider.kind`.
- **model**: `'native-audio'` (`gemini-2.5-flash-native-audio-preview`, cleaner
  Russian, v1alpha, weaker tool-calling) **| `'half-cascade'`** (`gemini-*-flash-live`,
  `language_code` supported, more reliable `submit_prompt`). Support **both**, user
  picks. Default: half-cascade (tool-heavy flow). Remove the old
  `gemini-2.0-flash-live-001`.
- **voice**: dropdown of that model's prebuilt voices (Callirrhoe/Autonoe/Puck/Kore/…);
  list swaps with the model.
- **personality prompt**: free-text — the assistant's name + character/tone. Merged
  as the persona layer of `system_instruction`.
- gating: `experimental_feature_voice` + VoltPro.

## 6. Prompt construction

`system_instruction` = concatenation, most-stable-first (prefix-cache friendly):

1. **Functional base (per UI language, ru/en — separate prompts).** Defines the
   co-pilot behavior: proactive greeting; discuss & refine intent; call
   `submit_prompt` with the synthesized final request when ready (not a transcript);
   relay results the agent gives via `say`; full-duplex etiquette.
2. **Personality** (user's setting): name + character/tone.
3. **Dynamic context**: for an existing chat, a compact block of the conversation
   history so Gemini understands the essence and proposes next steps. New chat →
   empty.

## 7. Session/event loop (target shape)

```
open: connect WS(/v1/gemini-live) → send setup{model,config,tools,systemInstruction}
      await setupComplete → send greeting trigger (text) → Gemini speaks first
mic worklet → continuous 16kHz PCM frames → engine.sendAudio  (NEVER gated)
recv loop:
  setupComplete            → ready
  serverContent.audio      → playback.enqueue (24kHz)
  interrupted              → playback.flush   (barge-in)
  input/outputTranscription→ (optional UI; not persisted)
  toolCall(submit_prompt)  → chatInstance.sendMessage(prompt); sendToolResponse(ok)
  (chat agent stream)      → extractWidgets → <widget:say> → engine.sendText(text)
close/error                → resumable reconnect (session_resumption handle)
```

## 8. Testing

- Backend: real WS-upgrade test — client WS connects, proxy opens a (mocked)
  upstream, frames pipe both ways, key injected, close propagates, size caps hold.
- Engine: protocol unit tests — setup shape, audio framing, toolCall parse,
  toolResponse, interrupted; PCM/base64 round-trip incl. odd lengths.
- Session: submit_prompt → sendMessage; say → sendText; greeting-on-open;
  ephemeral policy (voice turns produce no chat text except submit_prompt+answer).
- `say` widget: extractor pulls the tag from mixed text; executor routes to the
  active engine; skill instruction present in defaults.

## 9. Risks / open items

- **Echo over speakers** (invariant §2) — validate first on real hardware.
- **native-audio tool-calling reliability** for `submit_prompt` — mitigated by
  supporting both models + defaulting to half-cascade for the tool-driven flow.
- **GEMINI_API_KEY** — a real Google AI Studio key (same type as the Gemini model
  provider); NOT an OpenRouter key. Wire into `backend/src/config/settings.ts` +
  deploy env. Confirm the existing key the user referenced is a Google AI Studio key.
- v1alpha vs v1beta endpoint differs by model (native-audio needs v1alpha) — the
  proxy/engine must pick the right upstream path per model.
- Reconnect/`session_resumption` — port the prototype's resumable pattern.
