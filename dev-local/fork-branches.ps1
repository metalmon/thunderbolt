# Single source of truth for the fork's patch branches (6-branch license-clean model).
# Dot-source this file: . "$PSScriptRoot/fork-branches.ps1"
# NOTE: update this list (not rebuild-master.ps1) when the branch set changes.
#
# Apply order matters:
#   - fork/additive first — new fork-owned files (src/fork/**, zeroclaw-integration/**),
#     never conflicts;
#   - fork/rebrand before i18n — rebrand strings are i18n's raw material;
#   - fork/i18n before fork/i18n-locales (locales' content modifies the locales/**
#     skeleton that fork/i18n's i18next-init commit creates);
#   - fork/i18n before fork/hooks (hooks' UI seams merge with i18n t() wraps on the
#     shared components; rerere replays the merge);
#   - fork/voice-gemini-live after fork/hooks (its invasive seams — backend route
#     mount, ai/fetch voice-skill filter, voice.tsx co-pilot UI, local-settings
#     fields — layer on top of the hook + i18n edits to the same files);
#   - fork/anon-agent-manage after voice — a self-contained, removable seam that
#     relaxes custom-agent management for anonymous (local-only) accounts; lifts
#     out cleanly once stable/synced accounts land;
#   - fork/dev last so local dev/build overrides win.

$ForkBranches = @(
    "fork/additive",
    "fork/rebrand",
    "fork/i18n",
    "fork/i18n-locales",
    "fork/hooks",
    "fork/voice-gemini-live",
    "fork/anon-agent-manage",
    "fork/dev"
)

# Branches whose unique commits sit directly on main (cherry-pick range main..$b).
# fork/i18n-locales is the sole exception: it stacks on fork/i18n
# (range fork/i18n..fork/i18n-locales — see Get-CherryPickRange in rebuild-master.ps1).
$ForkMainRangeBranches = @(
    "fork/additive",
    "fork/rebrand",
    "fork/i18n",
    "fork/hooks",
    "fork/voice-gemini-live",
    "fork/anon-agent-manage",
    "fork/dev"
)
