#Requires -Version 5.1
<#
.SYNOPSIS
After rebasing a fork branch, show what the branch used to change and no longer does.

.DESCRIPTION
A rebase replays our commits onto a moved base. Where upstream rewrote the same
region, a hunk can be dropped — by a bad conflict resolution, or by a commit that
applied only partly — and nothing says so. The branch still builds often enough to
pass, and the loss surfaces weeks later as a feature that quietly stopped working.

That happened on 2026-10-13: `fork/sandbox-host` lost the third argument it adds to
`wrapArtifactHtml`, and it was found by chasing the fourth type error in a row rather
than by looking.

So: compare the branch's own patch before and after. Every line the old patch ADDED
should still be added by the new one, unless upstream now adds it themselves or we
deliberately adapted it. What this prints is therefore a list to read, not a verdict —
but a hunk that vanished silently cannot hide in it.

.EXAMPLE
  pwsh dev-local/rebase-verify.ps1 -Branch fork/sandbox-host -OldTip 3e119ccd7
  # find the old tip with: git reflog fork/sandbox-host
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$Branch,
    # The branch tip from BEFORE the rebase — `git reflog <branch>` lists it.
    [Parameter(Mandatory = $true)] [string]$OldTip,
    # The base it now sits on. The old base is derived, not asked for: the new base
    # descends from it, so their merge-base IS the commit the branch used to start at.
    [string]$NewBase = 'origin/main',
    [string]$NewTip = ''
)
$ErrorActionPreference = 'Stop'
if (-not $NewTip) { $NewTip = $Branch }

$oldBase = (git merge-base $OldTip $NewBase).Trim()
if (-not $oldBase) { throw "no merge-base between $OldTip and $NewBase" }

Write-Host "branch   : $Branch"
Write-Host "was      : $oldBase..$OldTip"
Write-Host "now      : $NewBase..$NewTip"
Write-Host ""

# Added lines only, keyed by file. Context and line numbers are deliberately ignored:
# they move on every rebase and would bury the signal in noise.
function Get-AddedLines([string]$range) {
    $map = @{}
    $file = $null
    foreach ($line in (git diff --unified=0 $range)) {
        if ($line -match '^\+\+\+ b/(.+)$') { $file = $Matches[1]; continue }
        if ($line -match '^\+\+\+ /dev/null$') { $file = $null; continue }
        if ($null -eq $file) { continue }
        if ($line.StartsWith('+') -and -not $line.StartsWith('+++')) {
            $text = $line.Substring(1).Trim()
            if ($text) {
                if (-not $map.ContainsKey($file)) { $map[$file] = New-Object System.Collections.Generic.HashSet[string] }
                [void]$map[$file].Add($text)
            }
        }
    }
    return $map
}

$before = Get-AddedLines "$oldBase..$OldTip"
$after = Get-AddedLines "$NewBase..$NewTip"

$lostFiles = @()
$lostLines = @()
foreach ($file in $before.Keys | Sort-Object) {
    if (-not $after.ContainsKey($file)) {
        $lostFiles += $file
        continue
    }
    $missing = $before[$file] | Where-Object { -not $after[$file].Contains($_) }
    if ($missing) { $lostLines += [pscustomobject]@{ File = $file; Lines = $missing } }
}

if (-not $lostFiles -and -not $lostLines) {
    Write-Host "Nothing the branch used to add is missing." -ForegroundColor Green
    exit 0
}

if ($lostFiles) {
    Write-Host "FILES THE BRANCH NO LONGER TOUCHES AT ALL:" -ForegroundColor Red
    $lostFiles | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
}

foreach ($entry in $lostLines) {
    Write-Host "$($entry.File) — $(@($entry.Lines).Count) line(s) no longer added:" -ForegroundColor Yellow
    $entry.Lines | Select-Object -First 25 | ForEach-Object { Write-Host "    - $_" }
    if (@($entry.Lines).Count -gt 25) { Write-Host "    … $(@($entry.Lines).Count - 25) more" }
    Write-Host ""
}

Write-Host "Read every line above. Each is either: upstream now provides it, we adapted"
Write-Host "it on purpose, or the rebase dropped it — and only the third is a bug."
