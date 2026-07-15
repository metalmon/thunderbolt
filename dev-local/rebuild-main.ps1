#!/usr/bin/env pwsh
# Regenerates local `main` from upstream mirror + cherry-picked fork branches.
#
# Branch model:
#   master  -> pristine mirror of origin/main (ff-only; never commit product work here)
#   feat/* / local/* -> single-concern patches listed in $Branches
#   main    -> master + cherry-pick($Branches); build/deploy this

[CmdletBinding()]
param(
    [string]$Remote   = "fork",
    [string]$Upstream = "origin",
    [switch]$Push
)

$ErrorActionPreference = "Stop"

$Branches = @(
    "feat/i18n-infra",
    "feat/i18n-wrap-settings",
    "feat/i18n-wrap-chat",
    "feat/i18n-wrap-auth",
    "feat/i18n-wrap-onboarding",
    "feat/i18n-wrap-tasks",
    "local/i18n-locales"
)

Write-Host "==> fetching $Upstream and $Remote" -ForegroundColor Cyan
git fetch $Upstream --prune
git fetch $Remote --prune

Write-Host "==> fast-forwarding master to $Upstream/main" -ForegroundColor Cyan
git checkout master
git merge --ff-only "$Upstream/main"

Write-Host "==> resetting main to master" -ForegroundColor Cyan
git checkout -B main master

foreach ($b in $Branches) {
    Write-Host "==> cherry-pick master..$b" -ForegroundColor Cyan
    git cherry-pick "master..$b"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "!!! cherry-pick conflict on $b." -ForegroundColor Red
        Write-Host "    Resolve, git cherry-pick --continue, then re-run." -ForegroundColor Red
        exit 1
    }
}

Write-Host "==> main rebuilt" -ForegroundColor Green
git --no-pager log --oneline -n ($Branches.Count + 1)

if ($Push) {
    git push --force-with-lease $Remote main
}
