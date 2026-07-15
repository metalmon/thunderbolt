# Fork ZeroClaw Additive/Hooks Split Implementation Plan (Migration B2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, with checkpoints) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **This is a git reorg that rewrites branch layout — do Task 0 (backups) first; never `push --force` without the user's explicit go-ahead.**

**Goal:** Split `fork/zeroclaw` into two license-clean branches — `fork/additive` (new fork-owned files, `src/fork/zeroclaw/**` + `zeroclaw-integration/**`) and `fork/hooks` (the thin seams that edit upstream files) — so the fork's relicensable IP is separated from its MPL upstream edits at the branch level, matching the design's target structure.

**Architecture:** Pure git reorg, **no code changes**. The additive/invasive separation already exists physically (fork logic lives in `src/fork/zeroclaw/**`; upstream files carry only import-plus-call seams). So each new branch is built fresh from `main` by checking out the relevant file set — the seam files are byte-identical to what `fork/zeroclaw` (and `fork/acp-fixes`) contribute today, so every recorded `rerere` resolution still replays and the rebuild stays a clean one-pass. To reach the design's **exact 5-branch model**, `fork/hooks` absorbs BOTH the ZeroClaw seams AND the acp-stop-busy fix (`fork/acp-fixes`) — both are "thin seams in upstream files (MPL)". `fork/acp-fixes` is retired at cutover.

**Tech Stack:** Git plumbing (`checkout -- <paths>`, `rerere`), PowerShell 7, `bun` (typecheck), Tauri.

## Global Constraints

- **No code changes.** This plan only moves existing file states between branches. If any step would alter file *content* (beyond what already exists on `fork/zeroclaw`/`main`), stop — that is out of scope.
- **License boundary (Design §Principle 1):** `src/fork/zeroclaw/**` + `zeroclaw-integration/**` = additive (fork IP, currently MPL-headered — header relicensing is a separate, user-decided task, NOT in this plan). Upstream-file edits = invasive (MPL).
- **CRLF / rerere / HUSKY:** repo-local `core.autocrlf=false`, `core.eol=lf`; `rerere.enabled`+`autoupdate` on; run rebuilds with `HUSKY=0`. (AGENTS.md §Environment.)
- **Seam content must stay byte-identical** to `fork/zeroclaw`'s versions, so the existing rerere cache replays. Verify with `git diff` against `fork/zeroclaw` after building each branch.
- **No force-push** without explicit user approval. Backups (Task 0) make every step reversible.
- **Target branch set after this plan (design's exact 5):** `fork/additive`, `fork/hooks`, `fork/i18n`, `fork/i18n-locales`, `fork/dev`. Both `fork/zeroclaw` and `fork/acp-fixes` are retired (`fork/hooks` absorbs the acp-stop-busy fix).

---

## File Classification (the split manifest)

**Additive → `fork/additive`** (all new files; whole directories):
```
src/fork/zeroclaw/**          (delivered-citations[.test].ts, zc-deliver-cite-note.ts,
                               outbound-resource-blob[.test].ts, delivered-uri-ref-map[.test].ts,
                               resolve-delivered-file[.test].ts, delivered-file-card.tsx, FORK.md)
zeroclaw-integration/**       (HAYSTACK-TO-ACP.md, specs/**, plans/**)
```

**Invasive → `fork/hooks`** (edits to existing upstream files). Two sub-groups:

*ZeroClaw seams (10 files, from `fork/zeroclaw` — seam-only, based on `main`):*
```
src/lib/assistant-message.ts
src/acp/translators/acp-to-ai-sdk.ts
src/components/chat/text-part.tsx
src/components/chat/assistant-message.tsx
src/widgets/document-result/pdf-sidebar-viewer.tsx
src/widgets/document-result/widget.test.tsx
src/widgets/document-result/instructions.ts
src/components/chat/source-card.tsx
src-tauri/tauri.conf.json
src/widgets/document-result/widget.tsx
```

*acp-stop-busy fix (3 files, from `fork/acp-fixes` commit e6756dae):*
```
src/chats/chat-instance.ts
src/lib/error-utils.ts
src/lib/error-utils.test.ts
```

*Shared by both (2 files) — need the MERGED version:*
```
src/acp/acp-adapter.ts
src/acp/acp-adapter.test.ts
```
`acp-adapter.ts`/`.test.ts` are edited by BOTH acp-stop-busy and the ZeroClaw seams. Their correct `fork/hooks` content is the merge of both, which already exists on `master` (nothing else — no i18n/dev — touches `acp-adapter`). So take these two from **`master`** (Task 2). With acp-stop-busy folded in, `fork/hooks` owns the full `acp-adapter` and it applies cleanly at rebuild (no other branch touches it).

Note: `source-card.tsx` / `text-part.tsx` / `pdf-sidebar-viewer.tsx` carry the seam only (no i18n wrap); `fork/i18n` keeps the wrap; they merge at rebuild via rerere. `tauri.conf.json` carries only the ZeroClaw blob-CSP; `fork/dev` keeps its port-CSP; they merge via the recorded CSP-union resolution.

---

## Task 0: Backups + preconditions

**Files:** none (git refs).

- [ ] **Step 1: Config + clean tree**

```bash
cd /c/dev/thunderbolt
git config core.autocrlf false; git config core.eol lf
git config rerere.enabled true; git config rerere.autoupdate true
export HUSKY=0
git status --porcelain | grep -v '^??' || echo CLEAN
```
Expected: `CLEAN`.

- [ ] **Step 2: Tag backups + record heads**

```bash
git tag -f backup/pre-b2/fork-zeroclaw fork/zeroclaw
git tag -f backup/pre-b2/fork-acp-fixes fork/acp-fixes
git tag -f backup/pre-b2/master master
git tag -l 'backup/pre-b2/*'
echo "zeroclaw: $(git rev-parse --short fork/zeroclaw)  acp-fixes: $(git rev-parse --short fork/acp-fixes)  main: $(git rev-parse --short main)"
```
Expected: 3 tags; note the heads in `.superpowers/sdd/progress.md`.

- [ ] **Step 3: Confirm target names are free**

```bash
for b in fork/additive fork/hooks; do git rev-parse --verify --quiet "$b" >/dev/null && echo "EXISTS $b" || echo "free $b"; done
```
Expected: both `free`.

---

## Task 1: Build `fork/additive` (fork-owned new files)

**Files:** creates branch `fork/additive`.

**Interfaces:** Produces `fork/additive` = `main` + all `src/fork/zeroclaw/**` + `zeroclaw-integration/**` (new files), in one commit.

- [ ] **Step 1: Create the branch from main and stage the additive tree**

```bash
git checkout -B fork/additive main
git checkout fork/zeroclaw -- src/fork/zeroclaw zeroclaw-integration
```

- [ ] **Step 2: Verify ONLY additive paths are staged (no upstream file leaked)**

```bash
git status --porcelain | grep -vE '^A  (src/fork/zeroclaw/|zeroclaw-integration/)' || echo "ONLY additive ✓"
```
Expected: `ONLY additive ✓` (every staged entry is `A` under one of the two fork dirs). If any other path appears, stop.

- [ ] **Step 3: Verify content matches `fork/zeroclaw` exactly for these paths**

```bash
git commit -q -m "feat(fork): ZeroClaw ACP additive IP — delivered-file citations, ref-map, resource-blob materialize (new files only)"
git diff --quiet fork/zeroclaw -- src/fork/zeroclaw zeroclaw-integration && echo "additive tree identical to fork/zeroclaw ✓" || echo "!! DIVERGES — investigate"
```
Expected: `additive tree identical to fork/zeroclaw ✓`.

---

## Task 2: Build `fork/hooks` (thin seams in upstream files + acp-stop-busy)

**Files:** creates branch `fork/hooks`.

**Interfaces:** Produces `fork/hooks` = `main` + acp-stop-busy (from e6756dae) + the 10 ZeroClaw seams (from `fork/zeroclaw`) + the 2 shared `acp-adapter` files (from `master`, already carrying both fixes merged) — in one commit. Does NOT compile alone (seams import from `@/fork/zeroclaw/*`, which lives on `fork/additive`) — expected; only assembled `master` compiles.

- [ ] **Step 1: Create from main, cherry-pick acp-stop-busy** (brings acp-adapter+test, chat-instance, error-utils+test with the stop-busy fix)

```bash
git checkout -B fork/hooks main
git cherry-pick fork/acp-fixes    # single commit e6756dae; applies clean on main
```
Expected: clean cherry-pick (no conflict).

- [ ] **Step 2: Overlay the 10 ZeroClaw seams (NOT acp-adapter) from `fork/zeroclaw`**

```bash
git checkout fork/zeroclaw -- \
  src/lib/assistant-message.ts \
  src/acp/translators/acp-to-ai-sdk.ts \
  src/components/chat/text-part.tsx \
  src/components/chat/assistant-message.tsx \
  src/widgets/document-result/pdf-sidebar-viewer.tsx \
  src/widgets/document-result/widget.test.tsx \
  src/widgets/document-result/instructions.ts \
  src/components/chat/source-card.tsx \
  src-tauri/tauri.conf.json \
  src/widgets/document-result/widget.tsx
```

- [ ] **Step 3: Take the merged `acp-adapter` (stop-busy + ZeroClaw) from `master`**

```bash
git checkout master -- src/acp/acp-adapter.ts src/acp/acp-adapter.test.ts
```

- [ ] **Step 4: Verify staged set (no additive files) and commit**

```bash
git diff --cached --name-only | grep -E '^src/fork/zeroclaw/|^zeroclaw-integration/' && echo "!! additive leaked" || echo "no additive files in hooks ✓"
git commit -q -m "feat(fork): upstream seams — ZeroClaw import-plus-call hooks + acp-stop-busy (MPL; ZeroClaw logic lives in src/fork/zeroclaw)"
```
Expected: `no additive files in hooks ✓`.

- [ ] **Step 5: Verify seam parity — each seam file matches its authoritative source**

```bash
# ZeroClaw seams must equal fork/zeroclaw:
for f in src/lib/assistant-message.ts src/acp/translators/acp-to-ai-sdk.ts src/components/chat/text-part.tsx src/components/chat/assistant-message.tsx src/widgets/document-result/pdf-sidebar-viewer.tsx src/widgets/document-result/widget.test.tsx src/widgets/document-result/instructions.ts src/components/chat/source-card.tsx src-tauri/tauri.conf.json src/widgets/document-result/widget.tsx; do
  git diff --quiet fork/zeroclaw -- "$f" || echo "!! ZC-seam DIVERGES: $f"
done
# acp-adapter + stop-busy files must equal master (the merged truth):
for f in src/acp/acp-adapter.ts src/acp/acp-adapter.test.ts src/chats/chat-instance.ts src/lib/error-utils.ts src/lib/error-utils.test.ts; do
  git diff --quiet master -- "$f" || echo "!! merged DIVERGES: $f"
done
echo "seam parity check done"
```
Expected: no `!! ... DIVERGES` lines.

---

## Task 3: Rewire tooling to the new branch set

**Files:**
- Modify: `dev-local/fork-branches.ps1` (on `fork/dev`)
- Modify: `dev-local/rebuild-master.ps1` (on `fork/dev`) — only if a range special-case is needed (it is not; see Step 2)
- Modify: `AGENTS.md` (on `fork/dev`)

**Apply order rationale:** `fork/additive` is new files (never conflicts). `fork/hooks` now owns the full `acp-adapter` (stop-busy + ZeroClaw pre-merged), so it applies cleanly with no acp-fixes branch to merge against. Its shared UI seams still merge with `fork/i18n` wraps, so `fork/hooks` must come AFTER `fork/i18n`; its `tauri.conf.json` merges with `fork/dev`'s, so BEFORE `fork/dev`. New order (5 branches): `fork/additive → fork/i18n → fork/i18n-locales → fork/hooks → fork/dev`.

- [ ] **Step 1: Check out `fork/dev` and rewrite `fork-branches.ps1`**

```bash
git checkout fork/dev
```
Replace the arrays (via Edit tool) so `$ForkBranches` is exactly (both `fork/zeroclaw` and `fork/acp-fixes` are gone; `fork/hooks` covers them; order matters):
```powershell
$ForkBranches = @(
    "fork/additive",
    "fork/i18n",
    "fork/i18n-locales",
    "fork/hooks",
    "fork/dev"
)
```
And `$ForkMainRangeBranches` = every branch except `fork/i18n-locales`:
```powershell
$ForkMainRangeBranches = @(
    "fork/additive",
    "fork/i18n",
    "fork/hooks",
    "fork/dev"
)
```

- [ ] **Step 2: Confirm `rebuild-master.ps1` needs NO change**

`Get-CherryPickRange` already returns `fork/i18n..fork/i18n-locales` for the locales branch and `main..$b` for all others. Both new branches (`fork/additive`, `fork/hooks`) sit directly on `main`, so `main..$b` is correct. No edit needed. Verify:
```bash
pwsh -NoProfile -Command '. dev-local/fork-branches.ps1; Write-Host "branches=$($ForkBranches.Count) mainRange=$($ForkMainRangeBranches.Count)"'
```
Expected: `branches=5 mainRange=4`.

- [ ] **Step 3: Update `AGENTS.md` `## Branch structure`**

Via Edit, replace BOTH the `fork/zeroclaw` bullet AND the `fork/acp-fixes` bullet with:
```markdown
- `fork/additive` — ZeroClaw ACP additive IP (new files in `src/fork/zeroclaw/**`,
  `zeroclaw-integration/**`; fork IP, currently MPL-headered).
- `fork/hooks` — thin import-plus-call seams in upstream files: ZeroClaw wiring
  + the acp-stop-busy fix (MPL, invasive). All ZeroClaw behaviour lives in
  `fork/additive`'s files.
```
(Keep `fork/i18n`, `fork/i18n-locales`, `fork/dev` bullets.) Update the apply-order line to:
```markdown
Apply order (rebuild): `fork/additive → fork/i18n → fork/i18n-locales → fork/hooks → fork/dev`.
```

- [ ] **Step 4: Commit**

```bash
pwsh -NoProfile -Command '. dev-local/fork-branches.ps1; if ($ForkBranches -contains "fork/zeroclaw") { throw "zeroclaw still listed" }; Write-Host "list OK ($($ForkBranches.Count))"'
HUSKY=0 git commit -am "chore(fork): retarget tooling + AGENTS.md — split fork/zeroclaw into fork/additive + fork/hooks"
```
Expected: `list OK (6)`.

---

## Task 4: Rebuild + typecheck (acceptance gate)

**Files:** none (produces `master`).

- [ ] **Step 1: Run the rebuild from `fork/dev`** (the script only exists on `fork/dev`; running it elsewhere fails with a pwsh usage error)

```bash
git checkout fork/dev
HUSKY=0 pwsh -NoProfile -File dev-local/rebuild-master.ps1
```
Expected: `==> master rebuilt`, **0 manual stops** — every seam↔wrap / seam↔acp-fixes / CSP conflict replays from the existing rerere cache (the seam content is byte-identical to `fork/zeroclaw`, so the cached resolutions match). If an **unrecorded** conflict appears, the seam content must have diverged — go back to Task 2 Step 3 and reconcile; do not hand-resolve a new conflict here.

- [ ] **Step 2: Confirm master content is unchanged vs the pre-split master**

```bash
git checkout master
git diff --stat backup/pre-b2/master master
```
Expected: **empty** (no diff). The split is content-preserving: the assembled `master` tree must be identical to the B1 master. A non-empty diff means a seam or additive file was dropped/altered — investigate before proceeding.

- [ ] **Step 3: Typecheck**

```bash
HUSKY=0 bun run type-check 2>&1 | tail -20
echo "errors: $(HUSKY=0 bun run type-check 2>&1 | grep -cE 'error TS')"
```
Expected: 0 errors (identical tree to the known-good B1 master).

- [ ] **Step 4: (Optional) user runtime build** — only if the user wants re-verification; the tree is byte-identical to the already-verified B1 master, so a rebuild is not strictly required. Command: `bun run tauri build --no-bundle --features native_fetch` (backend on `:8000`).

---

## Task 5: Cutover (guarded — requires user approval)

**Files:** none (git refs).

- [ ] **Step 1: Confirm Task 4 Step 2 showed an empty diff** and the user approves retiring `fork/zeroclaw` + `fork/acp-fixes`. Do not proceed otherwise.

- [ ] **Step 2: Delete both retired branches** (backup tags `backup/pre-b2/fork-zeroclaw` + `backup/pre-b2/fork-acp-fixes` remain):

```bash
git branch -D fork/zeroclaw fork/acp-fixes
git branch --list 'fork/*'
```
Expected exactly (design's 5): `fork/additive`, `fork/hooks`, `fork/i18n`, `fork/i18n-locales`, `fork/dev`.

- [ ] **Step 3: Update `.superpowers/sdd/progress.md`** — mark B2 complete, record new heads, note that header relicensing (MPL → fork license on `src/fork/zeroclaw/**` + `zeroclaw-integration/**`) remains an open, user-decided task.

---

## Self-Review

**Spec coverage (Design §Principle 1–3, Migration Phase 3):**
- Additive/invasive branch split → Tasks 1–2 (`fork/additive` + `fork/hooks`).
- Thin-hook architecture (Principle 2) → already satisfied in the existing code (seams are import-plus-call); this plan does not alter it, only relocates the files. Verified byte-identical in Task 2 Step 3.
- Tooling/docs (Phase 4) → Task 3.
- Design's exact 5-branch model (`fork/hooks` includes the acp-stop-busy fix) → Task 2 folds `fork/acp-fixes` into `fork/hooks`; both `fork/zeroclaw` and `fork/acp-fixes` retired at cutover. Final set = `fork/additive`, `fork/hooks`, `fork/i18n`, `fork/i18n-locales`, `fork/dev`.
- Header relicensing (making additive files carry a fork license) → explicitly OUT of scope (business/legal decision); noted in Global Constraints and Task 5 Step 3.

**Placeholder scan:** No TBD/TODO. The `fork-branches.ps1` snippet in Task 3 Step 1 contains an intentional inline instruction to remove the placeholder line; the concrete final list is stated explicitly right after. All commands have concrete expected output.

**Type/name consistency:** Branch names (`fork/additive`, `fork/hooks`) identical across the manifest, Tasks 1–5, `fork-branches.ps1`, and AGENTS.md. The seam-file split (10 ZeroClaw from `fork/zeroclaw` + 3 stop-busy + 2 shared `acp-adapter` from `master`) is identical in the manifest and Task 2. Apply order (`fork/additive → fork/i18n → fork/i18n-locales → fork/hooks → fork/dev`) identical in Task 3 rationale, the `$ForkBranches` list, AGENTS.md, and the acceptance expectation.

**Key invariant:** Task 4 Step 2 (`git diff backup/pre-b2/master master` is empty) is the whole plan's correctness gate — it proves the reorg preserved the product byte-for-byte.
