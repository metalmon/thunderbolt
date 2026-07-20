# Fork-only ZeroClaw ACP adapters (metalmon)

**Do not contribute these files (or their call-site hooks) to `thunderbird/thunderbolt` upstream.**

## Purpose

Thin adapters so Thunderbolt can talk **standard ACP** to ZeroClaw:

- Inbound attachments already use ACP `resource` + `blob` when `embeddedContext` is true (upstream TB).
- Outbound agent files (`deliver_file` → `tool_call_update.content` with `resource` + `blob`) are materialized here into IndexedDB + preview/download UI.

## License hygiene

- Thunderbolt is **MPL-2.0** (file-level copyleft). Edits inside existing MPL files remain MPL.
- New files under `src/fork/zeroclaw/` are **fork-owned**. Treat them as a Larger Work companion for ZeroClaw live-testing; keep logic here so upstream TB merges stay clean.
- Do **not** copy ZeroClaw design docs or proprietary specs into this tree.
- Do **not** open PRs to `thunderbird/thunderbolt` that include this directory or the one-line hooks that import it.

## Haystack

Haystack (Deepset) remains a separate managed-ACP path (`backend/src/haystack/`, `_meta.haystack*`, `GET /v1/haystack/files/:fileId`). See `zeroclaw-integration/HAYSTACK-TO-ACP.md` for the inventory and which pieces map to standard ACP vs stay Haystack-only.
