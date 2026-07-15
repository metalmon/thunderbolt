# Fork Maintenance Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two standalone, low-risk pieces of the fork-maintenance scheme — an upstream-impact analysis script and a tracked `AGENTS.md` rulebook — so upstream syncs become a known, tooled process.

**Architecture:** Two independent deliverables. (1) `dev-local/fork-upstream-impact.ps1` reads the git graph and, per fork branch, reports whether it touches files upstream changed since that branch's base — telling you exactly which branches need a rebase-forward. (2) `AGENTS.md` codifies the additive/invasive license boundary, the thin-hook rule, the branch structure, the sync workflow, and the environment requirements. Neither requires the (heavier, separate) branch-reorg or thin-hook migration.

**Tech Stack:** PowerShell 7 (Git Bash also available), Git plumbing (`merge-base`, `diff --name-only`), Markdown.

## Global Constraints

- **License boundary:** upstream is MPL-2.0 (file-level copyleft). Edits to upstream files stay MPL; new fork files carry the fork's own header and are relicensable. (Design §Driving constraint.)
- **Additive branches must never edit an upstream file;** invasive edits are minimized to thin hooks. (Design Principles 1–2.)
- **Target branch set** (names the tooling/doc must reference): `fork/additive`, `fork/hooks`, `fork/i18n-wrap`, `fork/i18n-locales`, `fork/dev`. (Design Principle 3.) The current branches still exist until the migration plan runs; the impact script must work with a **configurable branch list** so it serves both the current and target sets.
- **CRLF on Windows clones:** `core.autocrlf=false`, `core.eol=lf` (per-clone). (Design Principle 5.)
- **rerere** is enabled (`rerere.enabled`, `rerere.autoupdate`).
- **dev-local/ tooling** is tracked on a fork branch (like `rebuild-master.ps1` on `feat/i18n-infra`); `AGENTS.md` must be tracked so it rides onto `master`.

---

## File Structure

- `dev-local/fork-upstream-impact.ps1` (new) — the impact-analysis script. Single responsibility: given a branch list and an upstream ref, print per-branch conflict-risk.
- `dev-local/fork-branches.ps1` (new) — a tiny shared data file exporting the canonical fork branch list as `$ForkBranches`, dot-sourced by both `fork-upstream-impact.ps1` and (later, in the migration plan) `rebuild-master.ps1`. Removes the duplicated branch array. (DRY.)
- `AGENTS.md` (new, repo root, tracked) — the fork rulebook.

---

## Task 1: Shared fork-branch list

**Why:** `rebuild-master.ps1` hardcodes the branch array twice (it and the deleted `_continue-rebuild.ps1` both had it). The impact script needs the same list. Extract it once so there is a single source of truth.

**Files:**
- Create: `dev-local/fork-branches.ps1`

**Interfaces:**
- Produces: dot-sourcing this file defines `$ForkBranches` (string[], ordered as the rebuild applies them) and `$ForkMainRangeBranches` (string[], the branches whose unique commits sit directly on `main`).

- [ ] **Step 1: Create the shared list file**

Create `dev-local/fork-branches.ps1` with the current branch set (copied verbatim from `rebuild-master.ps1`'s `$Branches` / `$MainRangeBranches`):

```powershell
# Single source of truth for the fork's patch branches.
# Dot-source this file: . "$PSScriptRoot/fork-branches.ps1"
# NOTE: update this list (not rebuild-master.ps1) when the branch set changes.

$ForkBranches = @(
    "fix/make-format-windows",
    "fix/acp-stop-busy",
    "local/acp-standard-resource-blob",
    "local/acp-citations-ref-map",
    "feat/i18n-infra",
    "feat/i18n-wrap-settings",
    "feat/i18n-wrap-chat",
    "feat/i18n-wrap-auth",
    "feat/i18n-wrap-onboarding",
    "feat/i18n-wrap-tasks",
    "local/i18n-locales",
    "local/dev-fixes"
)

$ForkMainRangeBranches = @(
    "fix/make-format-windows",
    "fix/acp-stop-busy",
    "local/acp-standard-resource-blob",
    "local/acp-citations-ref-map",
    "feat/i18n-infra",
    "local/dev-fixes"
)
```

- [ ] **Step 2: Verify it dot-sources cleanly**

Run: `pwsh -NoProfile -Command '. dev-local/fork-branches.ps1; Write-Host "branches=$($ForkBranches.Count) mainRange=$($ForkMainRangeBranches.Count)"'`
Expected: `branches=12 mainRange=6`

- [ ] **Step 3: Commit** (on `local/dev-fixes` — fork tooling home; dev-local files are tracked there)

```bash
git checkout local/dev-fixes
git add dev-local/fork-branches.ps1
git commit -m "chore(fork): single source of truth for patch-branch list"
```

Note: `rebuild-master.ps1` is rewired to dot-source this in the migration plan (it lives on a different branch); leaving both for now is safe — they hold identical lists.

---

## Task 2: Upstream-impact analysis script

**Why:** When `origin/main` advances, you need to know which fork branches touch files upstream changed (those need a rebase-forward) versus which are untouched (safe). This replaces guessing / discovering conflicts only at rebuild time. (Design Principle 4.)

**Files:**
- Create: `dev-local/fork-upstream-impact.ps1`
- Consumes: `dev-local/fork-branches.ps1`

**Interfaces:**
- Invocation: `pwsh dev-local/fork-upstream-impact.ps1 [-Upstream origin/main] [-Fetch]`
- Behavior per branch B: `base = git merge-base <Upstream> B`; `upstreamChanged = git diff --name-only base <Upstream>`; `branchFiles = git diff --name-only base B`; `risk = intersection`. Prints a table and a summary list of branches to rebase.

- [ ] **Step 1: Write the script**

Create `dev-local/fork-upstream-impact.ps1`:

```powershell
#!/usr/bin/env pwsh
# Reports which fork branches touch files upstream changed since each branch's base.
# Branches with a non-empty intersection need a rebase-forward before the next rebuild.
[CmdletBinding()]
param(
    [string]$Upstream = "origin/main",
    [switch]$Fetch
)
$ErrorActionPreference = "Stop"
. "$PSScriptRoot/fork-branches.ps1"

if ($Fetch) {
    git fetch origin --prune | Out-Null
}

# Returns the sorted set-intersection of two string arrays (case-sensitive paths).
function Get-Intersection {
    param([string[]]$A, [string[]]$B)
    if (-not $A -or -not $B) { return @() }
    $set = [System.Collections.Generic.HashSet[string]]::new([string[]]$A)
    return @($B | Where-Object { $set.Contains($_) } | Sort-Object -Unique)
}

$upstreamHead = (git rev-parse --short $Upstream).Trim()
Write-Host "Upstream $Upstream @ $upstreamHead" -ForegroundColor Cyan

$toRebase = @()
foreach ($b in $ForkBranches) {
    $exists = git rev-parse --verify --quiet "$b"
    if ($LASTEXITCODE -ne 0) { Write-Host ("{0,-32} MISSING" -f $b) -ForegroundColor DarkYellow; continue }
    $base = (git merge-base $Upstream $b).Trim()
    $upstreamChanged = @(git diff --name-only $base $Upstream)
    $branchFiles     = @(git diff --name-only $base $b)
    $hits = Get-Intersection $upstreamChanged $branchFiles
    $behind = (git rev-list --count "$b..$Upstream").Trim()
    if ($hits.Count -gt 0) {
        $toRebase += $b
        Write-Host ("{0,-32} REBASE  ({1} colliding file(s), {2} upstream commits ahead)" -f $b, $hits.Count, $behind) -ForegroundColor Yellow
        foreach ($f in $hits) { Write-Host "    $f" -ForegroundColor DarkGray }
    } else {
        Write-Host ("{0,-32} safe    ({1} upstream commits ahead, 0 collisions)" -f $b, $behind) -ForegroundColor Green
    }
}

Write-Host ""
if ($toRebase.Count -gt 0) {
    Write-Host ("Rebase these {0} branch(es) onto {1}:" -f $toRebase.Count, $Upstream) -ForegroundColor Yellow
    $toRebase | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "No collisions — all branches are safe to cherry-pick as-is." -ForegroundColor Green
}
```

- [ ] **Step 2: Run against the real repo and verify output shape**

Run: `pwsh dev-local/fork-upstream-impact.ps1 -Upstream origin/main`
Expected: a line per branch. Given the known state (upstream 8 commits ahead of the i18n stack, `agent-install-dialog.tsx` / `acp-adapter.ts` collisions), at minimum `feat/i18n-wrap-settings` must print `REBASE` and list `src/components/settings/agents/agent-install-dialog.tsx`. Additive-only branches with no upstream-file overlap must print `safe`. Confirm the final summary lists the REBASE branches.

- [ ] **Step 3: Verify the intersection helper in isolation**

Run:
```
pwsh -NoProfile -Command '. dev-local/fork-upstream-impact.ps1 -Upstream HEAD 2>$null; ' 2>$null; `
pwsh -NoProfile -Command '
$A=@("a","b","c"); $B=@("b","c","d");
$set=[System.Collections.Generic.HashSet[string]]::new([string[]]$A);
$r=@($B | Where-Object { $set.Contains($_) } | Sort-Object -Unique);
if (($r -join ",") -eq "b,c") { "OK" } else { "FAIL: $($r -join ",")" }'
```
Expected: `OK` (intersection of `{a,b,c}` and `{b,c,d}` is `b,c`).

- [ ] **Step 4: Commit** (on `local/dev-fixes`)

```bash
git add dev-local/fork-upstream-impact.ps1
git commit -m "feat(fork): upstream-impact script — which branches need rebase"
```

---

## Task 3: AGENTS.md fork rulebook

**Why:** Codify the maintenance rules so future agents/developers preserve the license boundary and the thin-hook discipline instead of re-weaving logic into upstream files. (Design Principle 5.)

**Files:**
- Create: `AGENTS.md` (repo root)

**Interfaces:** none (documentation). Must be tracked so it rides onto `master` via the rebuild.

- [ ] **Step 1: Write `AGENTS.md`**

Create `AGENTS.md` at the repo root:

```markdown
# Fork Maintenance Rules (metalmon/thunderbolt)

This is a fork of `thunderbird/thunderbolt` (MPL-2.0). These rules keep the
fork maintainable against a moving upstream and keep our own IP cleanly
separable. Read before touching fork branches.

## License boundary — additive vs invasive

Upstream is **MPL-2.0** (file-level copyleft). Every change is exactly one of:

- **Additive (our IP):** NEW files only, under **our** license header, in
  `src/fork/**`, `zeroclaw-integration/**`, our locale catalogs, and fork
  docs. Never edits an upstream file. Relicensable / commercializable later.
- **Invasive (MPL):** edits to existing upstream files. Keep to the **absolute
  minimum**. Retains the MPL header. This is the only surface that conflicts
  when upstream advances.

**Rule:** never put fork logic inside an upstream file. Add a thin seam and
implement the logic in `src/fork/**`.

## Thin-hook rule

An invasive edit is one import + one `forkX(...)` call, nothing more. All
behavior lives in `src/fork/**`. Example: `src/acp/acp-adapter.ts` calls
`forkAcpTurnStart(sessionId)`; the ref-map / citation logic lives in
`src/fork/zeroclaw/*`. Exception: i18n `t()` wrapping is irreducibly invasive
— it is contained on its own branch, not eliminated.

## Branch structure

Patches live on branches based on `main` (assembled onto `master` by
`dev-local/rebuild-master.ps1`):

- `fork/additive` — our new-file IP (additive only, never edits upstream).
- `fork/hooks` — thin seams in upstream files (MPL).
- `fork/i18n-wrap` — `t()` wrapping of upstream components (MPL, invasive).
- `fork/i18n-locales` — our locale catalogs (additive).
- `fork/dev` — local dev/build fixes (not upstreamed).

The canonical list lives in `dev-local/fork-branches.ps1`.

## Upstream sync workflow

1. `git fetch origin --prune`
2. `pwsh dev-local/fork-upstream-impact.ps1` — see which branches collide with
   upstream's changes.
3. Rebase only the branches it flags onto `origin/main`; resolve conflicts
   once (rerere caches them).
4. `pwsh dev-local/rebuild-master.ps1` to reassemble `master`; build.

## Environment (Windows)

- Git config per clone: `git config core.autocrlf false; git config core.eol lf`
  (prevents phantom CRLF churn that jams checkouts/rebuilds).
- `git config rerere.enabled true; git config rerere.autoupdate true`
  (records conflict resolutions so rebuilds replay them).
- Run the rebuild with `HUSKY=0` so lint-staged does not reformat the tree
  mid-rebuild.
```

- [ ] **Step 2: Verify it renders and is tracked on a fork branch**

Run: `git checkout local/dev-fixes && git add AGENTS.md && git status --porcelain AGENTS.md`
Expected: `A  AGENTS.md` (staged, tracked).

- [ ] **Step 3: Commit** (on `local/dev-fixes` so it rides onto `master`)

```bash
git commit -m "docs(fork): AGENTS.md — fork maintenance rules and license boundary"
```

---

## Self-Review

**Spec coverage:**
- Design Principle 4 (impact tooling) → Task 2 (+ shared list in Task 1).
- Design Principle 5 (AGENTS.md) → Task 3; the AGENTS.md body also captures Principles 1–3 (license boundary, thin-hook, branch structure) and the environment requirements.
- Design Principles 1–3 (additive/invasive, thin-hook, target branch names) → documented in AGENTS.md; their **enforcement in code/branches** is the separate migration plan (Phases 1–3), explicitly out of scope here.
- Branch-reorg, `rebuild-master.ps1` rewrite, thin-hook extraction → deferred to the migration plan (stated in Architecture and Global Constraints).

**Placeholder scan:** No TBD/TODO. PowerShell and Markdown bodies are complete. Verification steps have concrete expected output. TDD note: these deliverables are a read-only analysis script and a doc — verification is real-repo execution + an isolated helper check, not unit tests, which is the honest fit.

**Type consistency:** `$ForkBranches` / `$ForkMainRangeBranches` names match between Task 1 (definition) and Task 2 (consumption). `fork-branches.ps1` path consistent across tasks. Branch names match the Global Constraints target set and the current set.

**Open item for execution:** all three commits land on `local/dev-fixes`. If the migration plan renames it to `fork/dev` first, retarget these commits accordingly — but this plan can run before the migration (the current branches still exist).
