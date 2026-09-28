# ZeroClaw `ui://` UI-resource artifacts (MCP-UI-aligned)

Status: Draft v2 (post adversarial review) · 2026-09-10 · Owner: fork/zeroclaw
UX addendum · 2026-09-10 (fork design review): side-panel-first surfacing, a chip re-entry anchor, and a client-derived title — see **§UX**; hardened after an adversarial pass (session registry, anchor-vs-content identity, gated auto-open, source-branched surfacing). Wire contract §3 is unchanged.
Paired spec (server side): ZeroClaw `docs/acp-ui-resource-artifacts.md` — **the wire contract in §3 is shared and must stay identical.**

> v2 corrects v1, which framed this as "a hook reusing existing paths." Adversarial review found the rendering and interaction paths are **hardwired** and this is **four net-new components** (§11). CSP-offline, the theme token names, and child→parent postMessage-without-`allow-same-origin` are the only v1 claims that held.

## 1. Goal

A remote ZeroClaw ACP agent renders **interactive HTML dashboards inline as artifacts** in Thunderbolt: rendered in the existing sandbox, identified by a stable `ui://` uri (update-in-place), theme-matched, and clickable (drill-down). Forward-compatible with MCP-UI / MCP Apps.

Non-goals (this iteration): Level-B in-iframe JSON-RPC; `_meta` UI templates; `svg`/`markdown` resources; consuming the gateway `/ws/canvas` surface.

## 2. Current state (verified in code — corrected)

- **Inbound translation:** `src/acp/translators/acp-to-ai-sdk.ts`, `case 'tool_call_update'`. On completion it emits `tool-output-available` with `output` and calls `materializeOutboundResourceBlobs(update.content, update.title)` (~L342). The client keys tools on **`update.title`** — there is **no `update.name`** on tool_call_update.
- **Resource extraction today:** `src/fork/zeroclaw/outbound-resource-blob.ts` reads `content[].content` → `block.resource` and **requires `blob`** → IndexedDB → file card (`file-card.tsx` / `delivered-file-card.tsx`). A `text` resource (our `ui://`) is currently ignored — good, no regression until the bridge lands.
- **Artifact rendering is render_html-specific:** recognition is `isRenderHtmlPart` = `getToolName(part) === 'render_html'` (`src/artifacts/render-html-tool.ts:26`); `src/components/chat/artifact-message-part.tsx` reads `artifactId = part.toolCallId` (**L31**) and `renderHtmlInput(part).html` = `part.input.html` (**L40**). There is **no path** from a `resource.text` in `tool_call_update.content` to an artifact, and the wire tool title is `canvas`, not `render_html`.
- **Sandbox:** the visible frame is `src/artifacts/sandboxed-html-frame.tsx` + `src/artifacts/harness.ts` + `src-tauri/src/sandbox.rs`/`sandbox-host.ts`. It is **cross-origin, immutable** content served from `sandbox://localhost/<id>` (Tauri) or a SW route — chosen specifically because srcdoc/blob are CSP-blocked. The host **cannot** mutate the frame DOM after load; changing HTML = re-wrap + **reload** (`useEffect` keyed on `wrappedHtml`, ~L109), which resets in-iframe JS state.
- **CSP / offline:** `artifactCsp` = `default-src 'none'` with `img/font/media/connect` limited to `data:`/`blob:`, `'unsafe-inline'`/`'unsafe-eval'` for inline JS/CSS (`harness.ts:34`). No network exfil (fetch/XHR/WS/beacon/remote-img all blocked). **Residual:** a script can navigate its own frame (`location=`, meta-refresh) → one outbound GET.
- **Existing message listener:** `parseHarnessMessage` (`harness.ts:51-64`) accepts only `artifact-ready | height | error`, gated by `event.source === iframe.contentWindow` **and** a per-render `artifactNonce` (**L56**). `origin` is **not** used (sandbox origin is opaque, shared by all artifacts). Child→parent `postMessage` works without `allow-same-origin` (`harness.ts:83`).
- **Theme:** Tailwind v4 tokens `--color-*`, `--radius*`, `--font-*` in `src/index.css` (L70, L130-137, L237-263). Dark mode is class-based (`@variant dark`), via `src/lib/theme-provider.tsx`. **The theme union is `light | dark | paper | system`** — not just light/dark.

## 3. Wire contract (SHARED — keep identical to the ZeroClaw spec)

```json
{
  "sessionUpdate": "tool_call_update",
  "toolCallId": "<id>",
  "title": "canvas",
  "status": "completed",
  "content": [
    { "type": "content", "content": { "type": "text", "text": "<short summary>" } },
    { "type": "content", "content": {
        "type": "resource",
        "resource": { "uri": "ui://pnl/dashboard", "mimeType": "text/html",
                      "text": "<!doctype html>…self-contained offline HTML…" } } }
  ]
}
```

Locked rules:
- Resource uses **`text`** (inline HTML), never `blob`.
- `uri` scheme **`ui://`**; **pinned prefix for this integration: `ui://pnl/<view>`** (e.g. `ui://pnl/dashboard`, `ui://pnl/anomalies`). Server and client MUST use the same prefix or updates fork into duplicate cards.
- `uri` is the **artifact identity** (update-in-place).
- `title` is advisory only — recognition is content-driven (`resource.uri` starts `ui://`), not title-based. (`name` is NOT a field on `tool_call_update`.)

## 4. Component 1 — resource → artifact bridge

Recognition today is hardwired to a `render_html` tool part; the `ui://` resource carries HTML in `content`, not in a `render_html` `input.html`. Build the bridge:

1. In `acp-to-ai-sdk.ts` `tool_call_update` handler, **before** `materializeOutboundResourceBlobs`, scan `content[]` for `content.type==='resource'` with `resource.uri` starting `ui://`. Predicate stays generic (any `ui://`), not canvas-specific. Act only on the **completed** update (the translator emits on `status:'completed'`), so there is no mid-stream or double open.
2. **Recognize the `ui://` resource and drive the artifact content-view** (`showArtifact` + the existing sandbox), reusing `renderHtmlInput`-style access so `.html = resource.text` flows into the same sandboxed frame. **Do NOT generalize `isRenderHtmlPart` for *surfacing*** (adversarial finding E): any part matching that predicate is rendered by `ArtifactMessagePart` as a streaming `InlineArtifactCard` (`artifact-message-part.tsx:46-47,57-59`) — the live inline card §UX forbids for `ui://`, and `groupMessageParts` also lifts matched parts into that path (`assistant-message.tsx:131`). Use a **separate `ui://` predicate + transcript part** that renders the chip only; it may share the artifact *content* rendering (sandbox), never the surfacing path. `render_html`'s inline-card path stays untouched.
3. Consume that resource so it does **not** also go to `materializeOutboundResourceBlobs` (no file card). Non-`ui://` resources fall through unchanged (no regression).
4. **Two transcript-grouping edits are required** (a separate `ui://` part cannot ride the existing dispatch, verify-pass finding E):
   - **Lift branch** in `groupMessageParts` (`lib/assistant-message.ts:110`): today only `isRenderHtmlPart && artifactRendersStandalone` (and delivered files) lift to top level. Add a parallel branch lifting the `ui://` part, so the chip is never buried in a collapsed `reasoning_group` (else the dashboard is unreachable).
   - **Dispatch branch** in the `case 'tool'` renderer (`assistant-message.tsx:130-134`), which currently routes every lifted non-delivered part to `ArtifactMessagePart`: route the `ui://` part to the **new chip part** instead — never to `ArtifactMessagePart` (which renders the forbidden inline card, and calls `renderHtmlInput(part).html`, undefined for `ui://`). Verify at impl that the lifted `ui://` part's `part.type` actually lands in `case 'tool'` (typed-tool vs `dynamic-tool` tag) so the branch is reached.

## 5. Component 2 — `uri → artifactId` identity map

Artifacts today are keyed by `part.toolCallId` (`artifact-message-part.tsx:31`; `ArtifactViewData.artifactId`, `content-view/context.tsx:34`) and every canvas call has a new `toolCallId`, so naive re-emits create new cards. But a plain uri-stable `artifactId` is **not** enough and actively breaks the UX (adversarial finding B): with a uri-stable id, `shownInPanel = state.data.artifactId === artifactId` (`artifact-message-part.tsx:43`) is true for *every* part sharing the uri → multiple "shown in side panel" bars at once. **Keep two identities separate:**

- **Content identity** — a stable **opaque hash of the `uri`**. This keys the panel content (`ArtifactViewData.artifactId`) and the update-in-place replace. NB: the citation hash `deliveredLocalFileId` (`outbound-resource-blob.ts:77`) is a *stateless* hash — it gives stable identity only and, by its own doc (`:148`), is **not** a live map. Borrow the hashing idea, not statefulness.
- **Anchor identity** — the emitting part's **`toolCallId`**. Only the part whose `toolCallId` equals the registry's `latestToolCallId` for that uri renders the live chip.

Add a real **session-scoped registry** (new client state — the citation hash is not this): `uri → { artifactId, latestToolCallId, dismissed, dismissedAtToolCallId }`.

- First sighting mints `artifactId`, sets `latestToolCallId`, `dismissed=false`.
- Re-emit updates `latestToolCallId` to the new part and **replaces** the panel HTML in place (reuse the streaming-preview refresh); earlier parts (toolCallId ≠ latest) stop rendering the live chip and collapse to a muted "superseded — updated below" (adversarial findings B, C).
- `dismissed` is set when the user closes the panel while it shows this uri; `dismissedAtToolCallId` records the `latestToolCallId` current at that close. Both are consulted before any auto-open (§UX); clicking the chip clears `dismissed`. The 4th field is what makes the **updated** chip state derivable (verify-pass finding): **ready** = `dismissed && dismissedAtToolCallId === latestToolCallId` (no re-emit since close), **updated** = `dismissed && dismissedAtToolCallId !== latestToolCallId` (a re-emit landed after close). `dismissed` alone cannot tell them apart — both are `true`.

**The registry must be reactive React state** (a context/provider or store beside `ContentViewProvider`), **not** a module-level `Map` (verify-pass finding C/2). Earlier parts are already mounted and `groupedParts` is memoized on `message.parts` (`assistant-message.tsx:159`), so a plain mutation would not re-render them; a registry change must re-render the stale parts so they flip to "superseded".

**Rehydrate on reload / chat-switch** (verify-pass finding 1, blocker). The registry is session-scoped and empty after a reload, while the transcript re-renders every `ui://` part. Rebuild it on mount from **transcript order**: per uri, the **last** `ui://` part in the stream is `latestToolCallId`, and `dismissed` resets to false (a reload is a fresh view). Without this, either no part is latest (dashboard unreachable) or all are (finding B regresses). Compute this **during render** (a `useMemo` over the full ordered message list — not a post-paint `useEffect`) so parts never render a frame with an empty registry (an all-superseded flash). The scan spans all messages, not one — `groupedParts` is per-message-memoized.

**`close()` sets `dismissed` from the live view** (verify-pass finding D). `close()` (`context.tsx:142-147`) takes no argument, but at close `state.data.artifactId` is still live: reverse-lookup its uri in the registry (1:1 — `artifactId` is the uri hash) and set that uri's `dismissed=true`, `dismissedAtToolCallId=latestToolCallId`. The drag-to-collapse path also routes through `close()` (`onResize … asPercentage===0 → close()`), so doing this inside `close()` covers every exit. Settles open-A / open-B-via-chip / close: only the uri currently shown is dismissed.

## 6. Component 3 — theme injection (honest model)

The frame is cross-origin/immutable, so there is no live DOM poke:

- **At wrap time**, the host snapshots resolved tokens from `document.documentElement` via `getComputedStyle` and injects them as the **first** `<style>:root{ … } !important</style>` inside the wrapped HTML, plus `color-scheme`. `!important` (or a post-agent injection point) is required because an agent's later `:root{}` would otherwise win the cascade (equal-specificity last-wins).
- **On theme toggle**, recolor = **re-wrap + reload** the frame (resets in-iframe JS/interaction state). Document this cost; acceptable for dashboards (state is re-derivable from the HTML, which is offline/static per render). NOT an instant live recolor.
- Map the full theme union (`light|dark|paper|system`) to `color-scheme` + token values; do not assume only light/dark.
- Token list (`src/index.css`): `--color-background/-foreground`, `--color-card(+-foreground)`, `--color-popover(+-foreground)`, `--color-muted(+-foreground)`, `--color-border`, `--color-input`, `--color-ring`, `--color-primary(+-foreground)`, `--color-secondary(+-foreground)`, `--color-accent(+-foreground)`, `--color-destructive(+-foreground)`, `--color-success(+-foreground)`, `--color-warning(+-foreground)`, `--color-brand(+-muted/-foreground)`, `--color-chart-1..5`, `--radius(+-sm/-md/-lg/-xl)`, `--font-heading`, `--font-size-body/-sm/-xs`. Agent HTML uses these with fallbacks; charts use `--color-chart-1..5`; agent MUST NOT redefine `--color-*`.

## 7. Component 4 — action channel (Level A: action → re-prompt → re-render)

The existing harness has no inbound action path (only ready/height/error, nonce-gated). Add:

1. **Harness:** expose a nonce-bearing `postAction(action)` inside the frame that posts `{ artifactNonce, kind:'action', action }` to the parent. Agent HTML calls it (do not raw-`postMessage`; that has no nonce and is rejected).
2. **Action shape = MCP-UI `onUIAction`** (locked so Level-B is a backing swap): `{ type:'tool', payload:{ toolName, params } }`, `{ type:'prompt', payload:{ prompt } }`, `{ type:'link', payload:{ url } }`, `{ type:'intent', payload:{ intent, params } }`, plus optional `messageId`. (NOT `{name,args}`.)
3. **Host listener:** filter by `event.source === iframe.contentWindow` **and** `artifactNonce` (drop `origin` — opaque). Validate against an **allowlist** (defined here in the host): permitted `type`s and, for `tool`, permitted `toolName`s + param schema. `link` → existing `ExternalLinkDialog`/`isSafeUrl`. Reject everything else.
4. **Translate** a valid action into a new ACP `session/prompt` to the same session, as a **structured directive** the agent's skill parses deterministically. The agent skill MUST re-validate the directive as **untrusted** input (defense in depth — the HTML is agent-authored but runs in a hostile-input position).
5. Agent re-emits the same `ui://` uri → artifact updates in place (§5).

## UX — surfacing, re-entry anchor, and title (client-only)

None of this is on the wire; it is all client behavior. §3/§9 pinned *what* renders, not *how* it is surfaced, re-opened, or named. These decisions fill that gap.

**Surface: side-panel-first, not a live inline card.** A dashboard is the primary deliverable, not an aside — the chat column is too narrow, and a live artifact rendered inline scrolls out of view as the conversation continues. So unlike `render_html` (which streams a full inline card and only *optionally* pops out), a `ui://` artifact's primary surface is the **side panel** (`showArtifact`, `state.type:'artifact'`). The transcript carries only a lightweight **chip anchor**, never a live inline render.

**Panel proportions — a `ui://` artifact opens wider than chat (mini-app).** The content view opens at a single global `defaultOpenWidth = 50%` (`content-view/constants.ts:22`) for *every* view type, persisted as `content_view_width` and user-resizable (`main-layout.tsx`). A `ui://` artifact is a full mini-app, not a document preview, so it must open **wider than the chat** — proposal ~66% (tune in the demo), not 50/50. Make the initial open width **per view type**: keep 50% for sideview/preview/object-view, use the wider default only when the opening view is an artifact (the open-animation target in `main-layout.tsx` keys on `state.type`). Constraints: the left chat panel has `minSize 360px` (`main-layout.tsx:115`), so on a narrow window the wider target clamps to `100% − 360px` — acceptable; note it. User resize still wins and persists; persist the artifact width under its **own** key so mini-app and document-preview proportions stay independent rather than overwriting one shared `content_view_width`. Three wiring points, not just the default (verify-pass findings 1–2):
- **(a) Open animation must key on `state.type`**, not only `isDesktopPanelOpen`. The animate-open effect (`main-layout.tsx`) reads the target once on closed→open; it must also re-animate to the per-type target when the view type changes *while open* — else a chip-clicked artifact replacing an open document (or a document opened over an artifact) keeps the wrong width (breaks AC 2c).
- **(b) `handleResize`'s write must also branch on `state.type`** and persist to the artifact key. Today it writes `content_view_width` unconditionally, so resizing an artifact would clobber the document-panel width.
- **(c) Desktop-only.** On mobile the panel is a full-screen dialog (`animate`/`handleResize` are already `!isMobile`), so "wider than chat" does not apply there.

**Chip anchor = a `ui://`-specific transcript part modeled on `ArtifactPanelBar`, NOT a generalized `render_html` part, NOT the citation widget.** The chip reuses the *look and role* of the existing "shown in side panel" bar (`artifact-message-part.tsx`), but must be its **own** part behind a **separate `ui://` predicate** — generalizing `isRenderHtmlPart` would route `ui://` through the streaming `InlineArtifactCard` (§4, finding E). Do **not** route this through the fork citation widget (`delivered-citations.ts` / `zc-deliver-cite-note.ts`) either: a citation is **agent-authored prose** resolving to a `local-file` **document sideview** with a **static** lifecycle — wrong trigger (prose vs `tool_call_update`), wrong target (`sideview` vs `artifact`), wrong lifecycle (static pointer vs update-in-place). The only thing borrowed from citations is the *hashing idea* (§5), not the widget and not its statelessness. (An optional in-prose *reference* to a dashboard — a future `CitationSource { artifactView: true }` resolving to `showArtifact` — is a separate, secondary affordance, never the primary anchor.)

**Open / re-open / update** — `ContentViewState` is a **single slot** (`context.tsx:37-42`); `showArtifact` blindly `setState` (`:137`) and would **evict** whatever the user has open. So auto-open is **gated**, never a blind steal (adversarial findings A, G, D):
- **First emit of a `uri`** → auto-open the side panel (`showArtifact`) **only if the slot is free** (`state.type === null`). If the user has any other view open (a document sideview, preview, object-view, or a different artifact), **do not steal it** — the chip renders in a "ready" state and the user opens it by click. (The earlier "or a superseded artifact" clause was dropped as unreachable — a same-uri re-emit updates in place and stays latest, a different uri never evicts, verify-pass finding A/G.)
- **Two different `ui://` in one turn** → the first may take a free slot; the second **never evicts** — "ready" chip.
- **Re-emit of the same `uri`** → update-in-place in the panel via the §5 registry; **never** re-open.
- **User has closed the panel** (`dismissed=true`, §5) → later re-emits update artifact state but **must not force the panel back open**; the chip shows an unobtrusive "updated" mark. Re-open is a click on the chip (which clears `dismissed`).
- **Re-entry after close** is always the transcript **chip** (the panel is ephemeral; the transcript is durable). There is no separate artifacts list — the chip is the only re-entry point, as the transcript part is today for `render_html`.

**One anchor per `uri` — on the latest emission.** Each emit is a new message-part with a new `toolCallId`, and parts render independently (`assistant-message.tsx:134`) with no cross-part awareness — so "latest wins" cannot be inferred locally (adversarial finding C). It is expressed through the §5 registry: a part renders the live chip only when its `toolCallId === registry[uri].latestToolCallId`; earlier parts read the registry, see they are stale, and collapse to a muted "superseded — updated below" (or nothing). One live anchor per dashboard.

**Chip states (enumerated)** (verify-pass finding 4). A chip is exactly one of:
- **ready** — latest part, artifact not in the panel now and not auto-opened (slot was busy on first emit, or the user closed it): "📊 {title} — open".
- **open** — latest part, artifact currently shown in the panel: the "shown in side panel — Show inline"-style bar.
- **updated** — latest part, `dismissed` **and** a newer emit landed since the close: "📊 {title} — updated · open".
- **superseded** — a non-latest part (`toolCallId ≠ latestToolCallId`): muted "superseded — updated below" (or hidden).

Only the latest part is ever ready/open/updated; only non-latest parts are superseded — the sets do not overlap. **ready** vs **updated** is derived from `dismissedAtToolCallId` (§5): ready = it equals `latestToolCallId` (no re-emit since close), updated = they differ (a re-emit landed). `dismissed` alone cannot tell them apart.

**Title — client-derived, never on the wire.** §3 carries no per-artifact title: `title:"canvas"` is the *tool* name (advisory), and adding a pretty-name field to the resource repeats the `filename`-on-ACP-resource pattern the citations spec explicitly **rejected** (pretty names belong in agent-authored content, not the wire). Derive the artifact/chip title client-side, in order:
1. the HTML document's `<title>` (natural for a self-contained page — like a browser tab);
2. else its first `<h1>`;
3. else the `uri` last segment (`ui://pnl/dashboard` → "Dashboard").

Parse with **`DOMParser`** (already used at `inline-artifact-card.tsx:24`), **not** a regex; take `textContent`, strip control characters, and **cap the length** (chip label). Recompute on every re-emit of the uri. The extracted string is used only as a text label (React escapes it; no `dangerouslySetInnerHTML` on this path), so it is display-safe. The short summary `text` block (§3) is **not** a title source this iteration. Instead, ask the **agent** — via a fork skill/prompt note, mirror of `ZEROCLAW_DELIVER_CITE_NOTE`, not the protocol — to include a meaningful `<title>` in the emitted HTML. (Server-side counterpart: paired spec §6a.)

## 8. Forward-compat (MCP Apps)

Action contract is already MCP-UI-shaped and recognition is `ui://`-generic, so Level-B = backing swap (replace prompt-translation with postMessage JSON-RPC `tools/call` round-trip; return result into the iframe). Agent HTML unchanged. `_meta` UI-templates later reuse the same renderer.

## 9. Acceptance criteria

1. Agent emits `ui://pnl/dashboard` (text/html) → **first emit auto-opens the side panel**; the transcript shows a **chip anchor**, not a live inline card (§UX).
2. Re-emit same `uri`, new HTML → **same** artifact updates in place (via §5 map), no duplicate card; if the user had closed the panel it stays closed and the chip marks "updated" (§UX). Only the latest emit keeps a live chip.
2b. Title shows the HTML `<title>` (→ `<h1>` → uri segment fallback); no title field is read off the wire (§UX).
2c. Opening a `ui://` artifact sizes the panel **wider than chat** (mini-app proportions, ~66%), not 50/50; opening a document/preview keeps 50% (§UX).
3. Toggle theme → artifact re-wraps+reloads with matching tokens (light/dark/paper); charts follow `--color-chart-*`. (Reload, not live poke.)
4. Dashboard calls `postAction({type:'tool',payload:{toolName:'drilldown',params:{pbo:'4517'}}})` → host validates (source+nonce+allowlist) → agent re-renders same uri. Raw `postMessage` / unknown `toolName` dropped.
5. `deliver_file` PDFs still render as file cards (no regression).

## 10. Risks / open questions

- **Frame self-navigation exfil** (`location=`/meta-refresh → GET): residual under current sandbox; note and, if feasible, restrict top-navigation.
- **DoS:** N live artifact iframes × up to 256 KB; add **LRU eviction** of artifact cards; server also retains 50 history frames/canvas (see server spec §5).
- **Theme cascade:** enforced via `!important` or post-agent injection; verify no agent override.
- Confirm the synthesized/generalized render_html part streams and pops-out identically to a native render_html artifact.
- Whether to show the summary `text` as message text alongside the artifact card (recommend yes).

## 11. Work breakdown (net-new — not a hook)

1. Resource→artifact bridge (§4) — `ui://` recognition (**separate predicate; do NOT generalize `isRenderHtmlPart`**) + the two grouping/dispatch edits (lift branch + `ui://` dispatch to the chip part) + drive the shared sandbox content-view; act only on `status:'completed'`.
2. Session registry (§5) — a **reactive** store `uri → { artifactId, latestToolCallId, dismissed, dismissedAtToolCallId }`, computed during render, rehydrate-from-transcript, and `close()` reverse-lookup wiring.
3. Theme injection at wrap + reload-on-toggle (§6).
4. Inbound action channel (§7) — harness `postAction`, host listener + allowlist, prompt translation.
5. UX (§UX) — side-panel-first surfacing; a **`ui://`-specific chip part** modeled on `ArtifactPanelBar` (not a generalized one); gated auto-open / update-in-place / no-force-reopen; one-anchor-per-`uri`; the enumerated chip states; wider mini-app panel proportions (§UX); client-derived title (+ fork agent skill note for `<title>`). Rides with component 2 (the registry owns identity, open-state, and re-entry).

Suggested phasing: **Phase 1 = components 1-3 + UX (static render + theme + surfacing/anchor/title)** to unblock the visual demo; **Phase 2 = component 4 (interaction)**.
