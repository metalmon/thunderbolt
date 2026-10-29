# Publishes the fork to the `fork` remote: every patch branch, then the
# assembled master.
#
# WHY A SEPARATE SCRIPT. Upstream's push flow does not apply to this repo: it
# assumes one linear branch pushed fast-forward. Here `master` is REASSEMBLED
# from scratch on every rebuild and each `fork/*` branch is rebased onto a
# moving upstream, so every ref needs a forced update — which is exactly the
# operation that silently destroys work when it is done without checks. The
# checks below are the point of this script; the pushes are the easy part.
#
#   pwsh dev-local/fork-push.ps1              # dry run: says what WOULD move
#   pwsh dev-local/fork-push.ps1 -Execute     # actually pushes
#
# `main` is NEVER pushed. It is a pristine mirror of `origin/main`; publishing
# it to our remote buys nothing and a stale local `main` would publish a lie.

param(
    [string]$Remote = "fork",
    [string]$Upstream = "origin",
    [switch]$Execute,
    # Skips the invariant check. For recovering a half-pushed state only — a
    # master that fails the invariant has LOST fork content, and publishing it
    # propagates the loss to every clone.
    [switch]$SkipInvariant
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/fork-branches.ps1"

function Fail([string]$message) {
    Write-Host "!!! $message" -ForegroundColor Red
    exit 1
}

# 1. A dirty tree means the refs do not describe what is on disk, and the
#    operator is about to publish something they have not seen.
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { Fail "working tree has uncommitted changes; commit or stash them first" }

# 2. force-with-lease compares against the REMOTE-TRACKING ref, so a stale one
#    makes the lease worthless — it would happily overwrite a push made
#    elsewhere. Refresh first; this is what makes the forced updates safe.
Write-Host "==> fetching $Remote to refresh the lease baseline" -ForegroundColor Cyan
git fetch $Remote --prune
if ($LASTEXITCODE -ne 0) { Fail "git fetch $Remote failed" }

# 3. The assembly invariant. sum(commits on each branch) must equal the count
#    on master, or the rebuild dropped fork content without conflicting.
if (-not $SkipInvariant) {
    $sum = 0
    foreach ($b in $ForkBranches) {
        $exists = git rev-parse --verify --quiet "$b"
        if (-not $exists) { Fail "branch $b does not exist locally" }
        $sum += [int](git rev-list --count "main..$b")
    }
    $assembled = [int](git rev-list --count "main..master")
    if ($sum -ne $assembled) {
        Fail "invariant broken: sum(branches) = $sum but main..master = $assembled — master lost fork content, do NOT publish it"
    }
    Write-Host "    invariant OK ($sum = $assembled)" -ForegroundColor Green
}

# 4. Report, but do not refuse, an assembly built on a stale upstream base.
#    Legitimate: we deliberately pin the base while upstream moves.
$mainLocal = git rev-parse --short main
$mainUpstream = git rev-parse --short "$Upstream/main"
if ($mainLocal -ne $mainUpstream) {
    $behind = git rev-list --count "main..$Upstream/main"
    Write-Host "    note: main is $behind commit(s) behind $Upstream/main (assembled on $mainLocal, upstream at $mainUpstream)" -ForegroundColor Yellow
}

$refs = @($ForkBranches) + @("master")

# ⚠ TWO traps live in these lines, and both make the report LIE rather than
# fail:
#
#   1. PowerShell variable names are CASE-INSENSITIVE, so a local `$remote`
#      silently overwrites the `$Remote` parameter. That turned every ref after
#      the first into a bogus "NEW branch" — hiding that the push rewrites
#      published history, which is the one thing this report exists to show.
#   2. Our branches are NAMED `fork/*` and the remote is also named `fork`, so
#      the short form `fork/additive` is ambiguous: it resolves to the LOCAL
#      branch, not to `refs/remotes/fork/fork/additive`. Comparing a ref with
#      itself always reports "up to date".
#
# Hence distinct names, and fully qualified refs everywhere.
Write-Host "==> refs to publish to '$Remote'" -ForegroundColor Cyan
$rewrites = 0
foreach ($ref in $refs) {
    $localRef = "refs/heads/$ref"
    $trackingRef = "refs/remotes/$Remote/$ref"
    $localTip = git rev-parse --short $localRef
    $hasTracking = git rev-parse --verify --quiet $trackingRef
    if ($hasTracking) {
        $trackingTip = git rev-parse --short $trackingRef
        $ahead = [int](git rev-list --count "$trackingRef..$localRef")
        $dropped = [int](git rev-list --count "$localRef..$trackingRef")
        if ($dropped -gt 0) {
            $shape = "REWRITES: drops $dropped published commit(s)"
            $rewrites += 1
        } elseif ($ahead -eq 0) {
            $shape = "already up to date"
        } else {
            $shape = "fast-forward"
        }
        $colour = if ($dropped -gt 0) { "Yellow" } else { "Gray" }
        Write-Host ("    {0,-28} {1} -> {2}  (+{3}, {4})" -f $ref, $trackingTip, $localTip, $ahead, $shape) -ForegroundColor $colour
    } else {
        Write-Host ("    {0,-28} NEW branch -> {1}" -f $ref, $localTip) -ForegroundColor Cyan
    }
}
if ($rewrites -gt 0) {
    Write-Host "    $rewrites ref(s) will DROP published commits. Normal for a reassembled fork — branches are rebased and master is rebuilt — but read the list before publishing." -ForegroundColor Yellow
}

if (-not $Execute) {
    Write-Host "==> dry run; nothing pushed. Re-run with -Execute to publish." -ForegroundColor Yellow
    exit 0
}

# 5. Branches first, master last: master is the assembly OF the branches, so if
#    the run dies midway the published master is never newer than its parts.
foreach ($ref in $refs) {
    Write-Host "==> push $ref" -ForegroundColor Cyan
    git push --force-with-lease $Remote "refs/heads/${ref}:refs/heads/${ref}"
    if ($LASTEXITCODE -ne 0) {
        Fail "push of $ref failed. If it was rejected by the lease, someone else pushed: fetch and reconcile rather than forcing."
    }
}

Write-Host "==> published $($refs.Count) refs to '$Remote'" -ForegroundColor Green
