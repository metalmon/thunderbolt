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
