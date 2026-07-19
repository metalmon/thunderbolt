#!/usr/bin/env pwsh
# Regenerates local `master` from upstream mirror + cherry-picked fork branches.
#
# Branch model (5-branch consolidated — see dev-local/fork-branches.ps1 + AGENTS.md):
#   main    -> pristine mirror of origin/main (ff-only; never commit product work here)
#   fork/*  -> single-concern patch branches listed in $ForkBranches
#   master  -> main + cherry-pick($ForkBranches); build/deploy/push this to fork master
#
# Every fork branch sits directly on main (range main..$b) EXCEPT fork/i18n-locales,
# which stacks on fork/i18n (range fork/i18n..$b) — its locale content modifies the
# locales/** skeleton that fork/i18n's i18next-init commit creates.

[CmdletBinding()]
param(
    [string]$Remote   = "fork",
    [string]$Upstream = "origin",
    [switch]$Push
)

$ErrorActionPreference = "Stop"

# Canonical branch list + apply order live in one place; dot-source it.
. "$PSScriptRoot/fork-branches.ps1"
$Branches = $ForkBranches

function Get-CherryPickRange {
    param([string]$Branch)
    # fork/i18n-locales is stacked on fork/i18n (its locale content modifies the
    # locales/** skeleton fork/i18n's i18next-init commit creates). All others sit on main.
    if ($Branch -eq "fork/i18n-locales") {
        return "fork/i18n..$Branch"
    }
    return "main..$Branch"
}

Write-Host "==> fetching $Upstream and $Remote" -ForegroundColor Cyan
git fetch $Upstream --prune
git fetch $Remote --prune

Write-Host "==> fast-forwarding main to $Upstream/main" -ForegroundColor Cyan
$mainExists = git rev-parse --verify main 2>$null
if ($LASTEXITCODE -eq 0) {
    git checkout main
    if ($LASTEXITCODE -ne 0) { throw "Failed to checkout main (is main checked out in another worktree?)" }
    git merge --ff-only "$Upstream/main"
    if ($LASTEXITCODE -ne 0) { throw "Failed to ff-only main to $Upstream/main" }
} else {
    git checkout -B main "$Upstream/main"
    if ($LASTEXITCODE -ne 0) { throw "Failed to create main from $Upstream/main" }
}

Write-Host "==> resetting master to main" -ForegroundColor Cyan
git checkout -B master main
if ($LASTEXITCODE -ne 0) { throw "Failed to reset master to main" }

$env:GIT_EDITOR = "true"  # never open an editor on --continue

foreach ($b in $Branches) {
    $range = Get-CherryPickRange $b
    Write-Host "==> cherry-pick $range" -ForegroundColor Cyan
    git cherry-pick $range
    if ($LASTEXITCODE -ne 0) {
        # rerere (autoupdate) may have already resolved + staged every conflict.
        # If no unmerged paths remain, continue automatically; otherwise stop.
        $unmerged = git diff --name-only --diff-filter=U
        if ([string]::IsNullOrWhiteSpace($unmerged)) {
            Write-Host "    rerere resolved all conflicts for $b — auto-continuing" -ForegroundColor Yellow
            git add -A
            git cherry-pick --continue
            if ($LASTEXITCODE -ne 0) {
                Write-Host "!!! auto-continue failed on $b ($range)." -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "!!! unrecorded cherry-pick conflict on $b ($range):" -ForegroundColor Red
            Write-Host $unmerged -ForegroundColor Red
            Write-Host "    Resolve, run: git add <files>; git cherry-pick --continue" -ForegroundColor Red
            Write-Host "    rerere will record this resolution so the next rebuild replays it automatically." -ForegroundColor Red
            Write-Host "    Then re-run this script." -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host "==> master rebuilt" -ForegroundColor Green
git --no-pager log --oneline -n ($Branches.Count + 5)

if ($Push) {
    git push --force-with-lease $Remote master
}

