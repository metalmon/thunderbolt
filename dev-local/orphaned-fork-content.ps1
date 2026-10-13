#!/usr/bin/env pwsh
# Report fork content present in a reference `master` that the current one no longer has.
#
# `rebuild-master.ps1` regenerates `master` from `$ForkBranches` alone, so anything
# committed straight to `master` — or parked on a branch outside that list — exists only
# until the next rebuild. The 0.1.138 sync lost the Linux glibc pin, the installer
# publisher, both sign-in callback pages, the explicit bundle target list and the whole
# agent-ownership feature exactly this way. None of it conflicted; the rebuild reported
# success and the work was simply gone.
#
#   pwsh dev-local/orphaned-fork-content.ps1 [-Reference fork/master] [-Current master]
#
# Works at LINE granularity on purpose. A file-level check is not enough: `tauri.conf.json`
# and `oauth_server.rs` are both touched by some patch branch, so they look "covered" while
# the specific lines that mattered are missing.
#
# Run it BEFORE rebuilding, while the reference still exists — afterwards the evidence is
# gone and the loss looks like it was never there. Same idea as `rebase-verify.ps1`, one
# level up: that one audits a rebased branch, this one audits the assembled product.

[CmdletBinding()]
param(
    # The master to audit against — the last one actually built and installed.
    [string]$Reference = "fork/master",
    [string]$Current   = "master",
    [string]$Upstream  = "origin/main"
)

$ErrorActionPreference = "Stop"

$refSha = (git rev-parse --verify "$Reference^{commit}" 2>$null)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve reference '$Reference'" }
$curSha = (git rev-parse --verify "$Current^{commit}" 2>$null)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve current '$Current'" }
$base = (git merge-base $refSha $Upstream)

Write-Host "reference : $Reference ($($refSha.Substring(0,9)))" -ForegroundColor Cyan
Write-Host "current   : $Current ($($curSha.Substring(0,9)))" -ForegroundColor Cyan
Write-Host ""

# Every line the fork ADDED in the reference, per file.
$addedByFile = @{}
$file = $null
foreach ($line in (git diff --unified=0 $base $refSha)) {
    if ($line -like 'diff --git *') {
        $file = ($line -split ' b/', 2)[1]
        continue
    }
    if ($null -eq $file) { continue }
    if ($line.StartsWith('+') -and -not $line.StartsWith('+++')) {
        $text = $line.Substring(1).Trim()
        # Noise: blank lines and bare punctuation match anywhere and prove nothing.
        if ($text.Length -lt 8) { continue }
        if (-not $addedByFile.ContainsKey($file)) { $addedByFile[$file] = [System.Collections.Generic.List[string]]::new() }
        $addedByFile[$file].Add($text)
    }
}

$missingTotal = 0
foreach ($f in ($addedByFile.Keys | Sort-Object)) {
    $now = git show "${curSha}:$f" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "$f — FILE IS GONE (was modified in the reference)" -ForegroundColor Red
        $missingTotal += $addedByFile[$f].Count
        continue
    }
    $haystack = ($now -join "`n")
    $missing = $addedByFile[$f] | Where-Object { -not $haystack.Contains($_) } | Select-Object -Unique
    if ($missing) {
        Write-Host "$f — $($missing.Count) line(s) the reference had and this one does not:" -ForegroundColor Yellow
        foreach ($m in ($missing | Select-Object -First 12)) { Write-Host "    - $m" }
        if ($missing.Count -gt 12) { Write-Host "    … $($missing.Count - 12) more" }
        $missingTotal += $missing.Count
    }
}

Write-Host ""
if ($missingTotal -eq 0) {
    Write-Host "Nothing the reference master carried is missing here." -ForegroundColor Green
    exit 0
}
Write-Host "Read every line above. Each is either upstream superseding it, a deliberate drop," -ForegroundColor Yellow
Write-Host "or fork work that died because no patch branch carries it — only the third is a bug." -ForegroundColor Yellow
exit 1
