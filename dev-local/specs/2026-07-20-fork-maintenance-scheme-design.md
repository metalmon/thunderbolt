# Fork Maintenance Scheme — Design

**Status:** Approved (2026-07-20)
**Context:** Fork `metalmon/thunderbolt` of upstream `thunderbird/thunderbolt` (MPL-2.0). The fork carries ~12 patch branches assembled onto `master` by `dev-local/rebuild-master.ps1` (reset to `main`, cherry-pick each branch). Every rebuild re-hits the same conflicts because fork branches are stale vs upstream and edits are woven into upstream files. This design establishes a stable long-term maintenance scheme.

## Goal

A durable, low-friction scheme for maintaining the fork against a moving upstream, that (a) keeps the fork's own IP cleanly separable for possible future commercialization, (b) minimizes the conflict surface when upstream advances, and (c) makes upstream-sync a repeatable, mostly-mechanical process with clear tooling.

## Driving constraint: the license boundary

Upstream is **MPL-2.0** — file-level copyleft. Modifications to upstream files must stay open (MPL). **New files** the fork authors are the fork's own IP and can carry a different license header (relicensable / commercializable later). Therefore the license boundary and the conflict boundary are the same line, and the scheme is organized around it.

## Principle 1 — Additive vs Invasive split

Every fork change is exactly one of:

- **Additive (fork IP):** new files only, in dedicated locations (`src/fork/**`, `zeroclaw-integration/**`, fork docs, fork locale catalogs). Carries the **fork's own license header**, never the MPL header. Never edits an upstream file. Rarely conflicts on upstream updates. Commercializable.
- **Invasive (MPL, open):** edits to existing upstream files. Kept to the **minimum** possible. Retains MPL headers. This is the only surface that conflicts when upstream advances.

## Principle 2 — Thin-hook architecture

Every invasive edit is reduced to the smallest possible seam:

- The upstream file gets an import + a single `forkX(...)` call. Nothing else.
- All real logic lives in the fork's `src/fork/**` files (additive, fork-licensed).
- Example — `src/acp/acp-adapter.ts` today has `clearDeliveredUriRefMap()`, delivered-uri ref-map wiring, and citation-note injection woven inline. Target: a couple of seams (`forkAcpTurnStart(sessionId)`, `forkAcpCompose(...)`) whose bodies live in `src/fork/zeroclaw/*`.
- Benefit: tiny upstream diffs → tiny conflict surface AND a clean license line (logic is fork-owned, only the seam is MPL).

**Irreducible exception — i18n wrapping.** Wrapping upstream UI strings in `t()` inherently edits upstream component files and cannot be reduced to a hook. This is the fork's one large invasive surface and thus the primary rebase-forward workload. It is not eliminated by this scheme — it is **contained**: isolated to its own branch(es), and its conflicts are absorbed by `git rerere` (already enabled) plus the impact tool below.

## Principle 3 — Target branch structure

Collapse the ~12 branches into a small, purpose-and-license-clear set, all based on `main` (history rewrite is acceptable — commit history is not a goal):

| Branch | Kind | License | Contents |
|---|---|---|---|
| `fork/additive` | additive | fork IP | zeroclaw impl, fork features, fork docs — new files only |
| `fork/hooks` | invasive | MPL | thin seam calls in upstream files (e.g. acp-adapter seams, acp-stop-busy fix) |
| `fork/i18n-wrap` | invasive | MPL | `t()` wrapping of upstream components (the main rebase target) |
| `fork/i18n-locales` | additive | fork IP | locale JSON catalogs (`locales/**`) |
| `fork/dev` | mixed/local | — | local dev/build fixes (`make-format-windows`, dev-fixes), not upstreamed |

Additive branches must never touch an upstream file (enforced by the impact tool / review). Exact commit-to-branch assignment is finalized in the migration plan.

## Principle 4 — Impact-analysis tooling: `fork-upstream-impact`

A script (PowerShell, in `dev-local/`) run after `git fetch origin`:

- Inputs: previous main ref (recorded) and new `origin/main`.
- Computes upstream's changed files: `git diff --name-only <old-main> <new-main>`.
- For each fork branch, computes the files it touches (`git diff --name-only main...<branch>`), intersects with upstream's changed set.
- Output: a table — `upstream advanced N commits; branch X touches M of the changed files → REBASE; branch Y touches 0 → safe`.
- Result: before any rebuild, you know exactly which branches need a rebase-forward and which are untouched.

## Principle 5 — `AGENTS.md` (fork rules, tracked)

A tracked top-level `AGENTS.md` (on `fork/dev` or a dedicated docs location so it rides onto master) codifying the rules for future agents and developers:

- The additive/invasive **license boundary** (MPL upstream vs fork-owned new files); which header goes on which.
- The **thin-hook rule**: never put logic in an upstream file; add a seam and implement in `src/fork/**`.
- The **branch structure** and what belongs where; additive branches never edit upstream files.
- The **upstream-sync workflow**: `git fetch origin` → `fork-upstream-impact` → rebase only affected branches → rebuild.
- That **rerere is enabled** (`rerere.enabled`, `rerere.autoupdate`) and conflict resolutions are cached/replayed.
- The **CRLF config requirement** for Windows clones (`core.autocrlf=false`, `core.eol=lf`) — per-clone, must be re-set on fresh clone.

## Migration (one-time, phased)

- **Phase 1 — Reorganize** existing commits into the new branch structure (additive vs invasive). History rewrite is fine.
- **Phase 2 — Rebase invasive branches onto current `main`** (currently 8 commits behind). Resolve conflicts once; `rerere` caches them; the last good master `805b1208` is the resolution oracle for files it uniquely owns (verify a file isn't re-touched by a later branch, e.g. `local/dev-fixes`, before taking 805b1208's version).
- **Phase 3 — Thin-hook extraction:** move woven logic (zeroclaw in `acp-adapter.ts`, citation injection) into `src/fork/**`, leaving only seams upstream.
- **Phase 4 — Tooling & docs:** `AGENTS.md`, `fork-upstream-impact` script, and update `rebuild-master.ps1` for the new branch set.

Likely decomposed into two implementation plans: **(A) Framework** (branch structure + tooling + AGENTS.md + rebuild update) and **(B) Thin-hook migration** (per-file extraction).

## Current-state facts (discovered during investigation)

- `main` is **8 commits ahead** of `feat/i18n-infra` and the wrap stack — the root cause of rebuild conflicts.
- Already committed this session (to be folded into the new structure): `.env.production` waitlist-bypass (Task 1), i18n OS-locale seed (Task 2), rerere-aware rebuild script (Task 3).
- Already fixed: CRLF phantom-churn via repo-local `core.autocrlf=false` + `core.eol=lf`; removed a stray `./NUL` file that broke `git add -A`; rebuild should run with `HUSKY=0` to avoid lint-staged reformatting the tree mid-rebuild.
- `rerere` is enabled and already holds recorded resolutions for `src/acp/acp-adapter.ts` and `src/components/settings/agents/agent-install-dialog.tsx`.
- `master` is currently parked at a partial-rebuild commit (`244905dc`); the last known-good full master is `805b1208` (reflog). Cleanup is part of Phase 1.

## Non-goals

- Rewriting the i18n approach to be non-invasive (out of scope; contained, not eliminated).
- Upstreaming individual features now (the additive structure keeps this possible later).
- Preserving fork commit history (explicitly not a goal).
