# Fork Branch Consolidation & Rebase-Forward Implementation Plan (Migration B1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan rewrites git history across branches — do Task 0 (backups) before anything else and never `push --force` without the user's explicit go-ahead.**

**Goal:** Collapse the fork's 12 patch branches into 5 purpose-and-license-clear topic branches, rebase the invasive ones forward onto the current `origin/main` (8 commits ahead of the i18n stack), and rewire the rebuild tooling — so `dev-local/rebuild-master.ps1` reassembles a working `master` in one clean pass and future upstream syncs are a tooled, mostly-mechanical process.

**Architecture:** Each new `fork/*` branch is created fresh from the current `main` (pristine `origin/main` mirror) and populated by cherry-picking that bucket's existing commits in order, resolving forward-port conflicts once (rerere caches them for the rebuild replay). Whole commits are bucketed by primary purpose — **no commit is split** (the file-level additive-vs-invasive separation that the design's `fork/additive`/`fork/hooks` split requires is deferred to the follow-up thin-hook plan, B2). The result is an interim-but-clean structure that eliminates the redundant branch, removes dev/docs noise from the i18n stack, and resolves the upstream drift.

**Tech Stack:** Git plumbing (`cherry-pick`, `merge-base`, `rev-list`, `rerere`), PowerShell 7, `bun` (build verification), Tauri.

## Global Constraints

- **License boundary:** upstream is MPL-2.0 (file-level copyleft). New fork files carry the fork header (`src/fork/**`, `zeroclaw-integration/**`, locale catalogs, fork docs); edits to upstream files stay MPL. This plan does not move code between files, so every commit keeps the license it has today. (Design §Driving constraint.)
- **CRLF on Windows clones:** repo-local `git config core.autocrlf false; git config core.eol lf` MUST be set before any checkout/cherry-pick, or phantom CRLF churn jams the operation. (AGENTS.md §Environment.)
- **rerere:** `git config rerere.enabled true; git config rerere.autoupdate true` MUST be set — this plan deliberately resolves each forward-port conflict once so the rebuild replays it. (AGENTS.md §Environment.)
- **HUSKY=0** for any commit/rebuild so lint-staged does not reformat the tree mid-operation.
- **No force-push** of `fork` remote branches or `master` without explicit user approval. Old branch names are retained as backups (Task 0) and are only deleted in the final cutover after the user confirms the rebuild is good.
- **Target branch set** (the tooling and AGENTS.md must reference exactly these): `fork/dev`, `fork/acp-fixes`, `fork/zeroclaw`, `fork/i18n`, `fork/i18n-locales`. (Interim structure; B2 later splits `fork/zeroclaw` into `fork/additive` + `fork/hooks`.)

---

## Commit → Bucket Map (the finalized assignment)

This is the single source of truth for which commits land on which new branch. Order within a bucket is the cherry-pick order (oldest first). Hashes are the current tips; forward-porting onto `main` produces new hashes.

**`fork/dev`** — local dev/build fixes + all fork tooling & docs (mixed/local, not upstreamed):
```
f28f5b7a  fix(dev): make format cargo detect work on Windows GnuWin32   (Makefile)
3e88d563  fix(dev): local compose, tauri CSP, and sidebar overflow      (compose, tauri.conf, capabilities, app.tsx)
901028d9  chore(fork): track .env.production ...                        (.gitignore)
4419d41a  docs(i18n): add fork rebuild-main pipeline for i18n stack     (dev-local docs)
1207d6a6  docs(i18n): stack fix/make-format-windows before i18n branches
e3d52552  docs(i18n): cherry-pick wrap ranges from infra tip
453874e1  docs(i18n): assemble fork product on master, mirror upstream on main
e7f07c1f  docs(i18n): include local/dev-fixes in rebuild stack
0e84b971  docs(i18n): include fix/acp-stop-busy in rebuild stack
eb7860e3  docs(i18n): include local/acp-standard-resource-blob in rebuild stack
c178df13  docs(i18n): include local/acp-citations-ref-map in rebuild stack
76cbc3b3  fix(dev): rerere-aware auto-continue in fork rebuild script
7a63e155  chore(fork): single source of truth for patch-branch list     (dev-local/fork-branches.ps1)
c32b6a59  feat(fork): upstream-impact script                            (dev-local/fork-upstream-impact.ps1)
ff9e2d0f  docs(fork): own AGENTS.md — fork rules over upstream          (AGENTS.md)
```
Note: the `docs(i18n): ...rebuild stack` commits describe the OLD branch model. They are carried for history continuity but Task 6 supersedes their content; do not treat them as current instructions.

**`fork/acp-fixes`** — invasive upstream ACP fix (MPL):
```
e6756dae  fix(acp): wait for settled prompt after Stop; skip SESSION_BUSY auto-retry
```

**`fork/zeroclaw`** — ZeroClaw ACP materialize + citation/widget ref-map (mixed additive `src/fork/zeroclaw/**` + invasive seams; B2 splits this). Absorbs the redundant `local/acp-standard-resource-blob` (its only commit `fb614c36` is the base of this stack):
```
fb614c36  feat(fork): materialize ACP resource+blob tool results for ZeroClaw
cd1993eb  docs(zeroclaw): spec citations/widgets via ACP deliver uri
b15fdc98  docs(zeroclaw): plan citations/widgets ACP resolve implementation
66f10469  feat(fork/zeroclaw): add delivered uri ref-map
ce5eba18  feat(fork/zeroclaw): register uri ref-map on outbound materialize
c4b01e8f  feat(fork/zeroclaw): resolve document-result fileId via uri map
e326b02e  feat(widgets): resolve document-result via ZeroClaw uri map
01d79968  feat(fork/zeroclaw): build [N] citations from delivered uri map
d42df38a  feat(chat): resolve ZC [N] citations to local-file sideview
8d98aded  feat(acp): inject ZeroClaw deliver_file citation note into compose
6654ddc8  docs(zeroclaw-integration): note ZC citation/widget resolve via uri map
e7b900e5  fix(fork/zeroclaw): clear delivered uri map at ACP turn start
6af8ac66  fix(acp): normalize footnote attachment cites and allow blob CSP
30406add  feat(fork): i18n delivered-file card labels via chat namespace   (⚠ uses i18n t())
3a247acc  feat(fork): i18n document preview unavailable and download aria   (⚠ uses i18n t())
```
⚠ The last two commits call `t()` — at rebuild time `fork/i18n` must be cherry-picked **before** `fork/zeroclaw` for the assembled master to typecheck. (Individual branches need not build alone.)

**`fork/i18n`** — i18next infra + all `t()` wrapping + render-time default translation + OS-locale seed (invasive MPL, the primary rebase-forward target). Linearized: the 11 shared infra commits once, then each wrap branch's disjoint tail, then the infra-tail i18n commits. **Excludes** the dev/docs commits (→ `fork/dev`) and locale commits (→ `fork/i18n-locales`):
```
# --- infra (shared base, minus docs) ---
7885834e  feat(i18n): add ui language normalize and detect helpers
f1453d10  feat(i18n): init i18next with en/ru namespace catalogs
bd41b703  feat(i18n): add synced ui_language setting default
c651810d  feat(i18n): mount I18nextProvider and sync ui_language
ad7882f0  feat(i18n): add Language select in Localization settings
b3442ef9  feat(i18n): one-shot ui_language detect on onboarding/preferences
fc25f24d  fix(i18n): dedupe concurrent ui_language auto-detect persists
4f8dbaa0  feat(i18n): translate built-in defaults at render time
# --- infra-tail i18n (from feat/i18n-infra, docs/dev excluded) ---
a314a87e  feat(i18n): seed RU localization units with language defaults
b94bdd75  feat(i18n): seed initial UI language from OS locale for pre-auth screens
# --- wrap tails (disjoint across branches) ---
6162d3a6  feat(i18n): wrap settings surfaces with t()
73cbe24d  feat(i18n): wrap agents, skills dialogs, and models settings
54341990  feat(i18n): wrap remaining settings MCP theme location gaps
ecf49d93  feat(i18n): wrap remaining settings agent chrome
03e34814  feat(i18n): wrap remaining models preferences validation messages
217525d7  feat(i18n): translate built-in agent description at render
cc114662  feat(i18n): wrap chat chrome with t()
6088f31a  feat(i18n): wrap tool loading and remaining chat chrome
3a66c5a6  feat(i18n): translate built-in tool display names
491d3abc  feat(i18n): EN keys and wraps for delivered-file and document preview
063480d4  feat(i18n): wrap auth and waitlist with t()
d6c777fa  feat(i18n): wrap onboarding with t()
d14db9bc  feat(i18n): wrap tasks page and common chrome with t()
bba53151  feat(i18n): wrap remaining common modals and status chrome
```
Ordering rationale: infra first (defines i18n runtime + keys used by wraps); settings-wrap group before chat/auth/onboarding/tasks (matches the current per-branch tails). `491d3abc` (delivered-file EN keys) precedes `fork/zeroclaw`'s `30406add`/`3a247acc` which reuse that namespace — but since those are on a different branch applied later, order is enforced at rebuild, not here.

**`fork/i18n-locales`** — RU/EN locale JSON catalogs (additive, fork IP):
```
c6b64cf2  i18n(locales): complete Russian translations for UI catalogs
8c6a8a2e  i18n(locales): Russian for remaining settings gaps
905faf87  i18n(locales): add tool display names and EN agent description
8bc2dd94  i18n(locales): fix sign-in email placeholder and built-in agent description
d0485062  i18n(locales): Russian for tool loading and remaining chrome
fa716db1  i18n(locales): Russian for models preferences validation leftovers
7f5b429b  i18n(locales): Russian for delivered-file and document preview
17aedffb  i18n(locales): EN keys for delivered-file and document preview
```
Note: `91ad3a18` (`docs: add UI i18n design`) is a pure design doc — carry it as the first commit of `fork/dev` OR drop it (superseded by `dev-local/specs/`). Default: **drop** (it is a stale planning doc; the design now lives in `dev-local/specs/2026-07-20-fork-maintenance-scheme-design.md`).

---

## File Structure

- `dev-local/fork-branches.ps1` (modify) — replace the 12-branch `$ForkBranches` / 6-branch `$ForkMainRangeBranches` arrays with the new 5-branch set and the new cherry-pick-range rules.
- `dev-local/rebuild-master.ps1` (modify) — dot-source `fork-branches.ps1` instead of hardcoding `$Branches`; simplify `Get-CherryPickRange` to `main..$b` for every branch (all new branches sit directly on `main`).
- `AGENTS.md` (modify) — update the `## Branch structure` list to the 5 real branch names.
- Git refs (create): `fork/dev`, `fork/acp-fixes`, `fork/zeroclaw`, `fork/i18n`, `fork/i18n-locales`; backup tags `backup/pre-consolidation/<old-branch>`.

---

## Task 0: Safety net — backup every branch and record base SHAs

**Why:** This plan rewrites history. Backups make every step reversible via `git reset --hard <tag>`.

**Files:** none (git refs only).

- [ ] **Step 1: Set required repo-local config**

```bash
cd /c/dev/thunderbolt
git config core.autocrlf false
git config core.eol lf
git config rerere.enabled true
git config rerere.autoupdate true
export HUSKY=0
```

- [ ] **Step 2: Confirm a clean working tree**

Run: `git status --porcelain | grep -v '^??' || echo CLEAN`
Expected: `CLEAN` (only untracked `dev-local/` scratch files may be present). If tracked files show modified, run `git add --renormalize .` then re-check; do not proceed until clean.

- [ ] **Step 3: Tag a backup of every current branch + master**

```bash
for b in fix/make-format-windows fix/acp-stop-busy local/acp-standard-resource-blob \
         local/acp-citations-ref-map feat/i18n-infra feat/i18n-wrap-settings \
         feat/i18n-wrap-chat feat/i18n-wrap-auth feat/i18n-wrap-onboarding \
         feat/i18n-wrap-tasks local/i18n-locales local/dev-fixes master main; do
  git rev-parse --verify --quiet "$b" >/dev/null && \
    git tag -f "backup/pre-consolidation/$(echo $b | tr / -)" "$b"
done
git tag -l 'backup/pre-consolidation/*'
```
Expected: 14 tags listed.

- [ ] **Step 4: Record the pristine main SHA for the plan's base**

Run: `git fetch origin --prune && git rev-parse --short origin/main`
Record the output as `MAIN_BASE` in `.superpowers/sdd/progress.md`. All new branches build on `origin/main`. (Confirm `main` is ff-only to `origin/main` first: `git checkout main && git merge --ff-only origin/main`.)

- [ ] **Step 5: Commit the progress note** (no code changed; just update the ledger via the Edit tool, not git). No git commit for this task.

---

## Task 1: Build `fork/i18n-locales` (additive locale content, STACKED on `fork/i18n`)

**Why:** Locale catalogs touch only JSON catalog files, BUT the `locales/**` skeleton is *created* by the i18n-infra commit `f1453d10` (in the `fork/i18n` bucket), and these commits *modify* that skeleton. So this branch has a hard git dependency on `fork/i18n` and must be built **after** Task 4 and stacked on it (discovered during execution: on bare `main` every locale file is a `DU` delete-by-us conflict). Its rebuild range is `fork/i18n..fork/i18n-locales` (Task 6), not `main..$b`. Fully carving the skeleton onto this branch (clean additive line) needs splitting `f1453d10` → deferred to B2.

**Files:** creates branch `fork/i18n-locales`.

**Interfaces:**
- Consumes: `fork/i18n` (Task 4).
- Produces: branch `fork/i18n-locales` = `fork/i18n` + 8 locale commits.

**Run AFTER Task 4.**

- [ ] **Step 1: Create the branch from `fork/i18n`**

```bash
git checkout -B fork/i18n-locales fork/i18n
```

- [ ] **Step 2: Cherry-pick the 8 locale commits in order**

```bash
git cherry-pick c6b64cf2 8c6a8a2e 905faf87 8bc2dd94 d0485062 fa716db1 7f5b429b 17aedffb
```
If a conflict stops it: resolve (locale JSON — keep both languages' keys), `git add <files>`, `git cherry-pick --continue`. rerere records the resolution.

- [ ] **Step 3: Verify the branch content**

Run: `git diff --name-only fork/i18n..fork/i18n-locales | sort -u`
Expected: only locale catalog paths (`locales/**`) — **no** upstream source files. If any non-locale file appears, a commit was mis-bucketed; stop and re-examine.

- [ ] **Step 4: Commit** — nothing to commit (cherry-pick already committed). Proceed.

---

## Task 2: Build `fork/acp-fixes` (single invasive commit)

**Files:** creates branch `fork/acp-fixes`.

**Interfaces:** Produces `fork/acp-fixes` = `main` + `e6756dae`.

- [ ] **Step 1: Create + cherry-pick**

```bash
git checkout -B fork/acp-fixes main
git cherry-pick e6756dae
```
Conflicts (main moved 8 ahead; `acp-adapter.ts` / `chat-instance.ts` / `error-utils.ts` may have upstream changes): resolve preserving the fork's Stop-settle / SESSION_BUSY-skip behavior on top of upstream's version. rerere records it.

- [ ] **Step 2: Verify it builds in isolation is NOT required** — individual fork branches need not compile alone. Just confirm the diff:

Run: `git diff --name-only main..fork/acp-fixes`
Expected: `src/acp/acp-adapter.test.ts src/acp/acp-adapter.ts src/chats/chat-instance.ts src/lib/error-utils.test.ts src/lib/error-utils.ts`.

---

## Task 3: Build `fork/zeroclaw` (citation stack, absorbs resource-blob)

**Files:** creates branch `fork/zeroclaw`.

**Interfaces:** Produces `fork/zeroclaw` = `main` + 15 commits (the `fork/zeroclaw` bucket, in listed order).

- [ ] **Step 1: Create + cherry-pick the stack**

```bash
git checkout -B fork/zeroclaw main
git cherry-pick fb614c36 cd1993eb b15fdc98 66f10469 ce5eba18 c4b01e8f \
                e326b02e 01d79968 d42df38a 8d98aded 6654ddc8 e7b900e5 \
                6af8ac66 30406add 3a247acc
```
Conflict guidance:
- `src/acp/acp-adapter.ts` — this file has a rerere resolution already recorded (progress ledger). The `t()`-using commits `30406add`/`3a247acc` will fail typecheck standalone (i18n not on this branch) — that is expected; do NOT add i18n commits here.
- Resolve to preserve the ZeroClaw ref-map wiring on top of upstream's `acp-adapter.ts`.

- [ ] **Step 2: Verify the branch content**

Run: `git diff --name-only main..fork/zeroclaw | sort -u`
Expected: `src/fork/zeroclaw/**` (additive) + `src/acp/**`, `src/components/chat/**`, `src/widgets/document-result/**`, `src/lib/assistant-message.ts`, `src/acp/translators/**` (invasive seams) + `zeroclaw-integration/**` docs. No i18n runtime files (`src/i18n/**`), no locale catalogs.

- [ ] **Step 3: Retire the redundant branch marker** — `local/acp-standard-resource-blob` (only `fb614c36`) is now fully contained in `fork/zeroclaw`. It stays tagged as a backup; no separate new branch. Note in progress ledger.

---

## Task 4: Build `fork/i18n` (the rebase-forward — highest conflict surface)

**Why:** This is the branch that was blocking the rebuild: `main` moved 8 commits ahead and the `t()` wraps touch 100+ upstream files that upstream also changed. Resolving these once here (rerere-cached) is the core value of the migration.

**Files:** creates branch `fork/i18n`.

**Interfaces:** Produces `fork/i18n` = `main` + the 24 i18n commits (infra → infra-tail → wrap tails), in the Commit→Bucket-Map order.

- [ ] **Step 1: Create the branch from main**

```bash
git checkout -B fork/i18n main
```

- [ ] **Step 2: Cherry-pick the infra base (8 commits)**

```bash
git cherry-pick 7885834e f1453d10 bd41b703 c651810d ad7882f0 b3442ef9 fc25f24d 4f8dbaa0
```
Likely conflicts: `package.json` / `bun.lock` (i18next dep — keep the dep, take upstream's other changes), `src/app.tsx` (provider mount vs upstream refactor), `src/defaults/settings.ts` + `.test.ts` (**bump `defaultSettingsVersion`** per CLAUDE.md if the reconciled default content changed relative to upstream). Resolve each; `git add`; `--continue`.

- [ ] **Step 3: Run the i18n unit tests as a checkpoint**

Run: `HUSKY=0 bun test src/i18n/ src/defaults/settings.test.ts 2>&1 | tail -20`
Expected: pass. If `settings.test.ts` fails on a version-bump assertion, bump `defaultSettingsVersion` in `src/defaults/settings.ts` and amend the relevant cherry-pick (`git commit --amend --no-edit` after staging).

- [ ] **Step 4: Cherry-pick the infra-tail i18n commits (2)**

```bash
git cherry-pick a314a87e b94bdd75
```
`b94bdd75` touches `src/i18n/i18n.ts` + test (OS-locale seed) — should apply cleanly on the infra base.

- [ ] **Step 5: Cherry-pick the wrap tails (14 commits, in map order)**

```bash
git cherry-pick 6162d3a6 73cbe24d 54341990 ecf49d93 03e34814 217525d7 \
                cc114662 6088f31a 3a66c5a6 491d3abc \
                063480d4 d6c777fa d14db9bc bba53151
```
This is the bulk conflict work. Guidance per conflict: the fork side wraps a literal in `t("ns:key")`; upstream may have edited the same JSX. **Keep upstream's structural change, re-apply the `t()` wrap around the new literal.** Where upstream deleted a wrapped string, drop the wrap. rerere records every resolution so the rebuild replays it. Commit progress to the ledger every few commits in case of interruption.

- [ ] **Step 6: Verify the branch content**

Run: `git diff --name-only main..fork/i18n | sort -u | grep -c '^src/i18n/locales' || true`
Expected: `0` — locale catalogs must NOT be on this branch (they are on `fork/i18n-locales`). If nonzero, a locale commit leaked in; remove it.

- [ ] **Step 7: Typecheck checkpoint**

Run: `HUSKY=0 bun run typecheck 2>&1 | tail -30` (or the project's tsc script)
Expected: pass, OR only failures traceable to cross-branch deps (i18n keys defined in `fork/i18n-locales`). Record any residual errors in the ledger for the assembled-master check (Task 7) rather than fixing here.

---

## Task 5: Build `fork/dev` (local/build fixes + tooling + docs)

**Why:** Consolidates `local/dev-fixes`, `fix/make-format-windows`, and the dev/docs commits currently scattered on `feat/i18n-infra` into one branch. Applied **last** at rebuild so local overrides win.

**Files:** creates branch `fork/dev`.

**Interfaces:** Produces `fork/dev` = `main` + 15 dev/tooling commits (the `fork/dev` bucket order).

- [ ] **Step 1: Create + cherry-pick**

```bash
git checkout -B fork/dev main
git cherry-pick f28f5b7a 3e88d563 901028d9 \
                4419d41a 1207d6a6 e3d52552 453874e1 e7f07c1f 0e84b971 \
                eb7860e3 c178df13 76cbc3b3 7a63e155 c32b6a59 ff9e2d0f
```
Conflicts: `Makefile` (Windows format detect vs upstream), `src/app.tsx` (tauri CSP/sidebar — **note this file is also touched by `fork/i18n` c651810d**; resolve to layer both concerns), `.gitignore`, `src-tauri/tauri.conf.json` (also touched by `fork/zeroclaw` 6af8ac66 blob CSP — layer both), and the `dev-local/**` docs/scripts (should apply clean, they are fork-owned new files).

- [ ] **Step 2: Verify the tooling files are present and current**

Run: `git show fork/dev:dev-local/fork-branches.ps1 >/dev/null && git show fork/dev:AGENTS.md >/dev/null && echo OK`
Expected: `OK`. (These get rewritten in Task 6.)

---

## Task 6: Rewire the tooling to the 5-branch model

**Why:** `fork-branches.ps1` and `rebuild-master.ps1` still describe the 12-branch model. Point them at the new branches so the rebuild assembles the consolidated structure.

**Files:**
- Modify: `dev-local/fork-branches.ps1` (on `fork/dev`)
- Modify: `dev-local/rebuild-master.ps1` (currently on `feat/i18n-infra`/`master`; new copy committed on `fork/dev`)
- Modify: `AGENTS.md` (on `fork/dev`)

- [ ] **Step 1: Check out `fork/dev` and rewrite `fork-branches.ps1`**

```bash
git checkout fork/dev
```
Replace the file body with (via Edit/Write tool, not shell):
```powershell
# Single source of truth for the fork's patch branches (5-branch consolidated model).
# Dot-source: . "$PSScriptRoot/fork-branches.ps1"
# Apply order matters: i18n before zeroclaw (zeroclaw reuses i18n t() keys);
# dev last so local overrides win.

$ForkBranches = @(
    "fork/acp-fixes",
    "fork/i18n",
    "fork/i18n-locales",
    "fork/zeroclaw",
    "fork/dev"
)

# All branches sit directly on main EXCEPT fork/i18n-locales, which stacks on
# fork/i18n (its content modifies the locales/** skeleton f1453d10 creates).
$ForkMainRangeBranches = @(
    "fork/acp-fixes",
    "fork/i18n",
    "fork/zeroclaw",
    "fork/dev"
)
```

- [ ] **Step 2: Bring `rebuild-master.ps1` onto `fork/dev` and simplify `Get-CherryPickRange`**

Copy the current script onto this branch, then dot-source the shared list and collapse the range logic. Using the Edit/Write tool, write `dev-local/rebuild-master.ps1` so that:
- Near the top, after `$ErrorActionPreference`, it dot-sources the list: `. "$PSScriptRoot/fork-branches.ps1"` and sets `$Branches = $ForkBranches`.
- Delete the hardcoded `$Branches` and `$MainRangeBranches` arrays.
- Replace `Get-CherryPickRange` with:
```powershell
function Get-CherryPickRange {
    param([string]$Branch)
    # fork/i18n-locales is stacked on fork/i18n (its locale content modifies the
    # locales/** skeleton that fork/i18n's f1453d10 creates). All others sit on main.
    if ($Branch -eq "fork/i18n-locales") { return "fork/i18n..$Branch" }
    return "main..$Branch"
}
```
Keep the ff-only-main, reset-master, rerere-auto-continue loop, and `-Push` logic unchanged. Apply order in `$ForkBranches` MUST keep `fork/i18n` before `fork/i18n-locales`.

- [ ] **Step 3: Update the `## Branch structure` section of `AGENTS.md`**

Using Edit, replace the bullet list under `## Branch structure` with the real branch names and one-line purposes:
```markdown
- `fork/acp-fixes` — invasive upstream ACP fixes (MPL).
- `fork/i18n` — i18next infra + `t()` wrapping + render-time default translation (MPL, invasive; the primary rebase-forward target).
- `fork/i18n-locales` — RU/EN locale catalogs (additive, fork IP).
- `fork/zeroclaw` — ZeroClaw ACP materialize + citation ref-map (mixed; B2 splits into additive/hooks).
- `fork/dev` — local dev/build fixes + fork tooling & docs (not upstreamed; applied last).

Apply order (rebuild): `fork/acp-fixes → fork/i18n → fork/i18n-locales → fork/zeroclaw → fork/dev`.
The canonical list lives in `dev-local/fork-branches.ps1`.
```

- [ ] **Step 4: Verify the list dot-sources and commit**

```bash
pwsh -NoProfile -Command '. dev-local/fork-branches.ps1; Write-Host "branches=$($ForkBranches.Count)"'
```
Expected: `branches=5`.
```bash
HUSKY=0 git commit -am "chore(fork): retarget tooling + AGENTS.md to 5-branch consolidated model"
```

---

## Task 7: Full rebuild + build verification (the acceptance gate)

**Why:** Proves the consolidated structure assembles a working `master` in one pass, with rerere replaying every resolution from Tasks 1–5.

**Files:** none (produces `master`).

- [ ] **Step 1: Run the rebuild against the new branches**

```bash
HUSKY=0 pwsh dev-local/rebuild-master.ps1
```
Expected: each `==> cherry-pick main..fork/<b>` completes; where a conflict recurs, `rerere resolved all conflicts ... auto-continuing`. Final: `==> master rebuilt`. If it stops on an **unrecorded** conflict, resolve it once (rerere will cache), then re-run — a second run should pass clean.

- [ ] **Step 2: Confirm master content equals the sum of branches**

Run: `git log --oneline main..master | wc -l`
Expected: 63 (64 unique commits minus the dropped `91ad3a18` design doc), give or take dropped-empty cherry-picks. Record the actual number.

- [ ] **Step 3: Typecheck the assembled master**

```bash
git checkout master
HUSKY=0 bun install
HUSKY=0 bun run typecheck 2>&1 | tail -30
```
Expected: pass. i18n keys (from `fork/i18n-locales`) and wraps (from `fork/i18n`) and zeroclaw `t()` calls now coexist, so the cross-branch type errors from Task 4 Step 7 must be gone. Fix any real error at its source branch and re-run the rebuild.

- [ ] **Step 4: Build the fork (user-run, runtime gate)**

Ask the user to run (per the local-build memory):
```
tauri build --no-bundle --features native_fetch
```
with the backend up on `:8000`. Expected: builds and launches without a black screen; language switch + a ZeroClaw citation render work. **This is a user-verified checkpoint — do not claim success without their confirmation.**

---

## Task 8: Cutover (guarded — requires user approval)

**Why:** Retire the 12 old local branches now that the 5 new ones + rebuilt master are verified. Backups (Task 0 tags) remain regardless.

**Files:** none (git refs).

- [ ] **Step 1: Confirm with the user that Task 7 passed** (typecheck + their runtime check). Do not proceed otherwise.

- [ ] **Step 2: Delete the superseded local branches** (backups keep them recoverable):

```bash
for b in fix/make-format-windows fix/acp-stop-busy local/acp-standard-resource-blob \
         local/acp-citations-ref-map feat/i18n-infra feat/i18n-wrap-settings \
         feat/i18n-wrap-chat feat/i18n-wrap-auth feat/i18n-wrap-onboarding \
         feat/i18n-wrap-tasks local/i18n-locales local/dev-fixes; do
  git branch -D "$b"
done
git branch --list 'fork/*'
```
Expected: the 5 `fork/*` branches remain.

- [ ] **Step 3: Push (only if the user asks)** — `fork` remote update is force-with-lease and must be explicitly approved:
```bash
# ONLY on explicit user go-ahead:
git push --force-with-lease fork fork/acp-fixes fork/i18n fork/i18n-locales fork/zeroclaw fork/dev master
```

- [ ] **Step 4: Update `.superpowers/sdd/progress.md`** — mark the consolidation complete, record the new branch heads, and note B2 (thin-hook extraction: split `fork/zeroclaw` → `fork/additive` + `fork/hooks`, shrink `acp-adapter.ts` seams) as the remaining migration phase.

---

## Self-Review

**Spec coverage (Design §Migration):**
- Phase 1 (reorganize commits into new branch structure) → Tasks 1–5 (bucketed by the Commit→Bucket Map).
- Phase 2 (rebase invasive branches onto current `main`) → Tasks 2–4 build fresh from `main`, forward-porting each invasive commit (the 8-commit drift resolved here, rerere-cached).
- Phase 3 (thin-hook extraction) → **explicitly deferred to B2** (stated in Architecture, Task 3, Task 8 Step 4). This plan does not split commits.
- Phase 4 (tooling & docs update) → Task 6 (`fork-branches.ps1`, `rebuild-master.ps1`, `AGENTS.md`).
- Design Principle 3 target names: this plan reaches an **interim** set (`fork/dev`, `fork/acp-fixes`, `fork/zeroclaw`, `fork/i18n`, `fork/i18n-locales`); the design's `fork/additive`/`fork/hooks` split is the B2 endpoint. This deviation is deliberate and documented (Global Constraints, Architecture) because the file-level split requires commit-splitting = thin-hook work.

**Placeholder scan:** No TBD/TODO. Every cherry-pick lists explicit hashes; conflict-resolution steps give concrete file-level guidance (they cannot pre-write resolutions — conflicts are data-dependent, so rerere-cached one-time resolution is the honest mechanism, exactly as the framework plan handled scripts/docs without unit tests).

**Type/name consistency:** `$ForkBranches` / `$ForkMainRangeBranches` names match `fork-branches.ps1` (Task 6) and its consumer `rebuild-master.ps1`. The 5 branch names are identical across the Commit→Bucket Map, Task 6, AGENTS.md, and Task 8. `defaultSettingsVersion` bump flagged where the reconciled default changes (CLAUDE.md rule).

**Open items for execution:**
- The 63-commit count (Task 7 Step 2) is an estimate; record the real number rather than treating a mismatch as failure (dropped-empty picks are normal).
- If `origin/main` advances again between Task 0 and Task 7, re-run `fork-upstream-impact.ps1`; only the flagged branches need re-resolution (rerere replays the rest).
