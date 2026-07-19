# Single source of truth for the fork's patch branches (5-branch consolidated model).
# Dot-source this file: . "$PSScriptRoot/fork-branches.ps1"
# NOTE: update this list (not rebuild-master.ps1) when the branch set changes.
#
# Apply order matters:
#   - fork/i18n before fork/i18n-locales (locales' content modifies the locales/**
#     skeleton that fork/i18n's i18next-init commit creates);
#   - fork/i18n before fork/zeroclaw (zeroclaw's delivered-file cards reuse i18n t() keys);
#   - fork/dev last so local dev/build overrides win.

$ForkBranches = @(
    "fork/acp-fixes",
    "fork/i18n",
    "fork/i18n-locales",
    "fork/zeroclaw",
    "fork/dev"
)

# Branches whose unique commits sit directly on main (cherry-pick range main..$b).
# fork/i18n-locales is the sole exception: it stacks on fork/i18n
# (range fork/i18n..fork/i18n-locales — see Get-CherryPickRange in rebuild-master.ps1).
$ForkMainRangeBranches = @(
    "fork/acp-fixes",
    "fork/i18n",
    "fork/zeroclaw",
    "fork/dev"
)
