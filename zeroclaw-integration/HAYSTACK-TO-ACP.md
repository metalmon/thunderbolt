# Haystack → standard ACP inventory (Thunderbolt fork)

_Heystack = typo for Haystack._ Inventory of Haystack-specific wire/UI vs the standard ACP shapes ZeroClaw uses for live testing.

| Feature | Current Haystack wire / UI | Target standard ACP | Action |
|--------|----------------------------|---------------------|--------|
| Advertise file prompts | `promptCapabilities.embeddedContext: true` when `supportedContent.files` | Same ACP capability | **Keep** (already standard) |
| Inbound PDF/DOCX attach | Client sends `resource{uri,mimeType,blob}`; Haystack ACP server uploads to Deepset `temporary_files` | Same inbound ContentBlock; ZC materializes to `uploads/` | **Keep** client path (standard). Server-side Deepset upload stays Haystack-internal |
| Answer streaming | `agent_message_chunk` text | Same | **Keep** |
| Citations / sources (Haystack) | `_meta.haystackReferences` / `_meta.haystackDocuments` on chunk + `PromptResponse` | No standard ACP citation ContentBlock today | **Keep Haystack-only** for Deepset; ZC does not emit `_meta.haystack*`. Future optional `_meta.zeroclaw` is out of scope |
| Numeric `[N]` citations (ZC path) | Haystack: same `_meta.haystack*` + remote file fetch | Client delivered uri ref-map: `turnPosition` → `localFileId` → sideview `local-file` | **Adapted for ZC** (ref-map from materialized outbound blobs; no Haystack fetch). Haystack `_meta` path unchanged for Deepset |
| Document preview by remote id | FE `GET /v1/haystack/files/:fileId` → sideview `document` | ACP `resource`+`blob` in `tool_call_update.content` → IndexedDB `localFileId` → sideview `local-file` | **Adapted for ZC** (ref-map + local-file). Haystack remote proxy remains for Deepset agents |
| `document-result` widget | `<widget:document-result fileId=…>` → Haystack file fetch | `fileId` matches delivered `uri` in ref-map → sideview `local-file` | **Adapted for ZC** (ref-map + local-file; Haystack remote unchanged) |
| Outbound file to client | Not used by Haystack (proxy fetch) | ZC `deliver_file` → `tool_call_update` content `resource`+`blob` | **Implement** (P0b) |
| Session resume | `session/load` + Deepset `search_session_id` map | ZC `loadSession` / workspace session | **Orthogonal**; leave Haystack map alone |
| Non-standard ACP methods | None beyond Deepset HTTP behind the adapter | N/A | **Drop** from ZC path concerns |
| Transport URL | `/v1/haystack/ws?pipeline=` | ZC gateway `/acp` (or bridge WS) | **Keep both** agent types; no dual protocol on the ZC agent |

## One-commit fork strategy

1. **Fork-owned** `src/fork/zeroclaw/*` — extract/store outbound `resource`+`blob`, UI card for preview/download.
2. **Tiny hooks** in MPL sources (`acp-to-ai-sdk.ts`, `assistant-message.ts`, `assistant-message.tsx`) — import fork helpers only.
3. **Do not** rip out Haystack `_meta` / file proxy in this commit (would break managed Deepset agents). Dual path is: Haystack remote `fileId` **or** standard ACP blob → local file; ZC live tests use the latter only.

## Remaining gaps

- Haystack Deepset citations still need `_meta.haystack*` (no ACP standard equivalent); ZC path uses delivered uri ref-map for `[N]` and widget `fileId` instead.
- Embedding Deepset source PDFs as outbound `resource`+`blob` from the Haystack ACP server (to eliminate `/haystack/files`) is a separate, larger backend change.
