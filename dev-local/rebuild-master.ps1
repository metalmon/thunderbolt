#!/usr/bin/env pwsh
# Regenerates local `master` from upstream mirror + cherry-picked fork branches.
#
# Branch model:
#   main    -> pristine mirror of origin/main (ff-only; never commit product work here)
#   feat/* / local/* -> single-concern patches listed in $Branches
#   master  -> main + cherry-pick($Branches); build/deploy/push this to fork master
#
# Wrap / locale branches are stacked on feat/i18n-infra, so they cherry-pick
# feat/i18n-infra..$b (delta only). Base patches use main..$b.

[CmdletBinding()]
param(
    [string]$Remote   = "fork",
    [string]$Upstream = "origin",
    [switch]$Push
)

$ErrorActionPreference = "Stop"

$Branches = @(
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

# Branches whose unique commits sit directly on main (not stacked on infra).
$MainRangeBranches = @(
    "fix/make-format-windows",
    "fix/acp-stop-busy",
    "local/acp-standard-resource-blob",
    "local/acp-citations-ref-map",
    "feat/i18n-infra",
    "local/dev-fixes"
)

function Get-CherryPickRange {
    param([string]$Branch)
    # Citations stack on resource-blob materialization (same idea as wrap/infra).
    if ($Branch -eq "local/acp-citations-ref-map") {
        return "local/acp-standard-resource-blob..$Branch"
    }
    if ($MainRangeBranches -contains $Branch) {
        return "main..$Branch"
    }
    return "feat/i18n-infra..$Branch"
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

Write-Host "==> master rebuilt" -ForegroundColor Green
git --no-pager log --oneline -n ($Branches.Count + 5)

if ($Push) {
    git push --force-with-lease $Remote master
}

