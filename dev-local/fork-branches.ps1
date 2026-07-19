# Single source of truth for the fork's patch branches.
# Dot-source this file: . "$PSScriptRoot/fork-branches.ps1"
# NOTE: update this list (not rebuild-master.ps1) when the branch set changes.

$ForkBranches = @(
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

$ForkMainRangeBranches = @(
    "fix/make-format-windows",
    "fix/acp-stop-busy",
    "local/acp-standard-resource-blob",
    "local/acp-citations-ref-map",
    "feat/i18n-infra",
    "local/dev-fixes"
)
