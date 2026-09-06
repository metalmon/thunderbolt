# Single source of truth for the fork's patch branches (6-branch license-clean model).
# Dot-source this file: . "$PSScriptRoot/fork-branches.ps1"
# NOTE: update this list (not rebuild-master.ps1) when the branch set changes.
#
# Apply order matters:
#   - fork/additive first — new fork-owned files (src/fork/**, zeroclaw-integration/**),
#     never conflicts;
#   - fork/rebrand before fork/lingui-ru — rebrand strings feed the catalogs;
#   - fork/lingui-ru (was fork/i18n + fork/i18n-locales) — the fork's i18n now
#     rides upstream's own Lingui (as of 0.1.129). All this branch adds is the
#     Russian catalog + trimming the shipped set to en/ru/en-XA (drops upstream's
#     de/es/fr/ja/pt-BR) + the src/i18n locale-registry edits. The old i18next
#     branches fork/i18n + fork/i18n-locales are RETIRED (frozen at 0.1.124,
#     superseded by upstream Lingui); their refs are kept only for archaeology.
#     The per-feature Lingui macro wraps live on their own feature branches.
#   - fork/voice-gemini-live after fork/hooks — adds ONLY the Gemini Live engine
#     (src/voice/engine/gemini-live-engine.ts) into upstream's existing voice router,
#     plus the backend relay route + voice.tsx UI seams. Forward-ported cleanly onto
#     0.1.129 (the feared "redesign" was a plain rebase — upstream owns the router and
#     all other engines; the fork only slots one more in). BYOK key refactor is a
#     separate follow-up (see memory gemini-byok-key-refactor).
#   - fork/anon-agent-manage after voice — a self-contained, removable seam that
#     relaxes custom-agent management for anonymous (local-only) accounts; lifts
#     out cleanly once stable/synced accounts land;
#   - fork/sandbox-host before fork/dev — adds frame-src to tauri.conf CSP (fork/dev
#     also edits that block: worker-src); rerere replays the two-line CSP merge.
#   - fork/spinner near the end (after the content-editing branches) — it swaps
#     lucide Loader2 for the Volt <Spinner> across many UI files; applying it after
#     i18n/hooks/voice have wrapped/edited those files keeps the Loader2-line diffs
#     conflict-free. i18n-neutral (no locales touched).
#   - fork/perf near the end, same reason — GPU-smooth panel/overlay animation
#     tweaks (drop backdrop-blur on moving surfaces, transform-slide the sidebar,
#     remove the detail-panel glow) across many UI primitives; apply after the
#     content branches so its class-string diffs stay conflict-free.
#   - fork/hide-integrations near the end — TEMPORARY, removable: hides Google/
#     Microsoft integrations + disables the connect-integration skill until the
#     backend has OAuth creds. Delete this line (and the branch) once configured.
#   - fork/docx-viewer near the end — swaps the upstream mammoth-in-sandboxed-
#     iframe docx preview for a paginated docx-preview renderer (fork-owned files
#     under src/fork/documents/, one-line swap in the upstream pdf-sidebar-viewer).
#     Additive + one small upstream hunk; apply after the content branches.
#   - fork/dev last so local dev/build overrides win.

$ForkBranches = @(
    "fork/additive",
    "fork/rebrand",
    "fork/lingui-ru",
    "fork/hooks",
    "fork/voice-gemini-live",
    "fork/anon-agent-manage",
    "fork/sandbox-host",
    "fork/spinner",
    "fork/perf",
    "fork/hide-integrations",
    "fork/docx-viewer",
    "fork/dev"
)

# Branches whose unique commits sit directly on main (cherry-pick range main..$b).
# Every active branch is now a main-range branch — the old stacked exception
# (fork/i18n-locales on fork/i18n) retired with the i18next branches.
$ForkMainRangeBranches = @(
    "fork/additive",
    "fork/rebrand",
    "fork/lingui-ru",
    "fork/hooks",
    "fork/voice-gemini-live",
    "fork/anon-agent-manage",
    "fork/sandbox-host",
    "fork/spinner",
    "fork/perf",
    "fork/hide-integrations",
    "fork/docx-viewer",
    "fork/dev"
)
