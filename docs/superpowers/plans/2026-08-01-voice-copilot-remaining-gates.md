# Handoff: Gemini Live voice co-pilot — remaining gates

**Status:** feature-complete + reviewed on branch `fork/voice-gemini-live`
(HEAD ~`3ddfcf8a`, 27 commits, **NOT pushed**, **NOT in the rebuild stack**).
Design/plan/spec live on that branch under `docs/superpowers/`. See memory
`gemini-live-voice-copilot.md`. All 12 SDD tasks done; assembled-branch
typecheck 0; src/voice tests green; WS bearer-subprotocol auth reviewed secure.

## Remaining gates (why it isn't shipped yet)

### 1. Hardware echo smoke — the #1 risk (MANUAL, needs a human at the machine)
Full-duplex realtime means the mic streams continuously and **must never be
gated/paused** (stream manipulation crashes Gemini Live — battle-tested
invariant). Echo is handled ONLY in the AEC layer (browser
`echoCancellation:true` + the `src/voice/audio/playback.ts` reference graph).
**Test on real hardware over SPEAKERS** (not headphones): enable voice
(provider "Gemini Live"), let Gemini speak aloud, confirm it does NOT
self-trigger / feed back and does NOT error from stream continuity. If browser
AEC is insufficient on loud speakers, add software AEC that subtracts the known
playback signal from the mic — still a CONTINUOUS stream, never a gate.

### 2. GEMINI_API_KEY — ALREADY SET ✅
The key is already configured in the powersync deploy env — no action needed.
(It must be a Google AI Studio key, not an OpenRouter key. The backend relay
`backend/src/fork/gemini-live/routes.ts` reads `process.env.GEMINI_API_KEY` and
injects it into the upstream `wss://generativelanguage.googleapis.com` handshake.)

### 3. Add the branch to the rebuild stack + rebuild
Once echo is validated: add `fork/voice-gemini-live` to
`dev-local/fork-branches.ps1` `$ForkBranches` (apply order: after `fork/hooks`,
before/with `fork/dev` — it's additive-ish + a few invasive seams; the voice
branch already has a commit wiring itself into the rebuild script). Then
`pwsh dev-local/rebuild-master.ps1` (HUSKY=0) and confirm typecheck 0 on the
assembled master. Push `fork/voice-gemini-live`.

## Follow-ups (non-blocking, after merge)
- `resolveVoiceLang()` uses a `navigator.language` stopgap because the voice
  branch is based on upstream `main` (no i18n). When assembled with `fork/i18n`,
  upgrade it to read the `ui_language` setting.
- Re-verify the `geminiVoices` catalogs against current
  `ai.google.dev/gemini-api/docs/live-guide` before a real ship (they were
  correct as of 2026-07-31; catalogs move).
- Deferred minors are listed in the branch's SDD ledger / commit history.

## What the feature does (one paragraph, for context)
Proactive full-duplex voice: on open Gemini greets first, discusses to refine
intent, then calls its `submit_prompt(prompt)` function → the synthesized prompt
becomes a normal user message to the chat agent (gost); the agent voices results
by emitting `<widget:say text="…">` in its reply → the client extracts the tag →
`engine.sendText` → Gemini speaks it. Ephemeral: only submit_prompt's prompt +
the agent's answer persist to chat. VoltPro-gated. `say` is both a client widget
and a skill advertised ONLY when voice is enabled (shared `filterVoiceOnlySkills`
predicate, applied to BOTH the ACP `_meta` payload and the built-in agent prompt).
