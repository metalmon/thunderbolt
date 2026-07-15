#!/usr/bin/env pwsh
# Regenerates local `main` from upstream mirror + cherry-picked fork branches.
#
# Branch model:
#   master  -> pristine mirror of origin/main (ff-only; never commit product work here)
#   feat/* / local/* -> single-concern patches listed in $Branches
#   main    -> master + cherry-pick($Branches); build/deploy this
#
# Wrap / locale branches are stacked on feat/i18n-infra, so they cherry-pick
# feat/i18n-infra..$b (delta only). Base patches use master..$b.

[CmdletBinding()]
param(
    [string]$Remote   = "fork",
    [string]$Upstream = "origin",
    [switch]$Push
)

$ErrorActionPreference = "Stop"

$Branches = @(
    "fix/make-format-windows",
    "feat/i18n-infra",
    "feat/i18n-wrap-settings",
    "feat/i18n-wrap-chat",
    "feat/i18n-wrap-auth",
    "feat/i18n-wrap-onboarding",
    "feat/i18n-wrap-tasks",
    "local/i18n-locales"
)

# Branches whose unique commits sit directly on master (not stacked on infra).
$MasterRangeBranches = @(
    "fix/make-format-windows",
    "feat/i18n-infra"
)

function Get-CherryPickRange {
    param([string]$Branch)
    if ($MasterRangeBranches -contains $Branch) {
        return "master..$Branch"
    }
    return "feat/i18n-infra..$Branch"
}

Write-Host "==> fetching $Upstream and $Remote" -ForegroundColor Cyan
git fetch $Upstream --prune
git fetch $Remote --prune

Write-Host "==> fast-forwarding master to $Upstream/main" -ForegroundColor Cyan
$masterExists = git rev-parse --verify master 2>$null
if ($LASTEXITCODE -eq 0) {
    git checkout master
    if ($LASTEXITCODE -ne 0) { throw "Failed to checkout master" }
    git merge --ff-only "$Upstream/main"
    if ($LASTEXITCODE -ne 0) { throw "Failed to ff-only master to $Upstream/main" }
} else {
    git checkout -B master "$Upstream/main"
    if ($LASTEXITCODE -ne 0) { throw "Failed to create master from $Upstream/main" }
}

Write-Host "==> resetting main to master" -ForegroundColor Cyan
git checkout -B main master
if ($LASTEXITCODE -ne 0) { throw "Failed to reset main to master (is main checked out in another worktree?)" }

foreach ($b in $Branches) {
    $range = Get-CherryPickRange $b
    Write-Host "==> cherry-pick $range" -ForegroundColor Cyan
    git cherry-pick $range
    if ($LASTEXITCODE -ne 0) {
        Write-Host "!!! cherry-pick conflict on $b ($range)." -ForegroundColor Red
        Write-Host "    Resolve, git cherry-pick --continue, then re-run." -ForegroundColor Red
        exit 1
    }
}

Write-Host "==> main rebuilt" -ForegroundColor Green
git --no-pager log --oneline -n ($Branches.Count + 5)

if ($Push) {
    git push --force-with-lease $Remote main
}
