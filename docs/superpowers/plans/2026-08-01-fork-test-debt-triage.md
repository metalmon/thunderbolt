# Fork test-debt triage + fix plan (authoritative)

**Date:** 2026-08-01. Supersedes `2026-08-01-fake-timers-waitfor-debt.md` (whose
premise — "~78 order-dependent fake-timer failures, each file passes in
isolation" — is wrong). Based on a 6-agent parallel audit + direct verification.

## Ground truth

Same Windows machine, junctioned node_modules, `bun test --cwd=src --randomize`:
- clean `origin/main` 0.1.120 = **4110 pass / 0 fail / 0 timer errors**
- assembled `master` = ~4086 pass / **~85–87 fail / ~30 timer straddles**

⇒ 100% fork-caused. Upstream frozen at our base — nothing to pull. Latest
`@testing-library/dom` (10.4.1) — no library fix.

## Three categories of failure

### CATEGORY A — timer-straddle throws (~30) — FIXED
`waitFor` calls `jest.advanceTimersByTime` resolving `jest` from `bun:test`, not
the `globalThis.jest` shim the fork patched. A leaked poll ticks a dead clock →
"Fake timers are not active" → poisons later tests. **Fix on `fork/dev`,
`src/test-utils/fake-timers.ts`**: route bun's jest timer methods through a
guarded `activeClock` indirection. 30→0, deterministic. Typecheck exit 0.
APPLIED (working tree, uncommitted). Does not lower fail count — makes the suite
deterministic.

### CATEGORY B — REAL source regressions / ship-broken bugs (~11 tests, 7 defects)
These fail in TRUE isolation. The i18n migration dropped logic / missed keys.
Tests are CORRECT alarms — fix the SOURCE, do NOT edit the tests.

| # | Defect | Fix (source) | Branch |
|---|---|---|---|
| B1 | ErrorMessage dropped cause-specific error guidance (5 tests) | Restore `getChatErrorKind` + per-kind map in `src/components/chat/error-message.tsx`, rendering `t('errors.<kind>')` | fork/i18n (code) + fork/i18n-locales (keys) |
| B2 | CitationBadge collapsed count-aware "N sources" aria-label to single-source (1) | Restore count branch in `citation-badge.tsx` `getBadgeLabel` | fork/i18n + fork/i18n-locales |
| B3 | SkillsView `library-row.tsx` disable/enable aria uses slug not displayName (5, in skills-view.test.tsx) | `library-row.tsx`: pass `displayName` to disableAria/enableAria | fork/i18n |
| B4 | `skills.slug` locale key missing → raw key as Slug label (SkillsView 3 + SkillForm 4) | add `skills.slug: "Slug"` | fork/i18n-locales (en+ru) |
| B5 | create-item panel title rendered as raw key `skills.createSkillTitle` (create-item-host 1) | wrap title in `t()` at DetailPanel boundary in `create-item-panel-shell.tsx` / `create-skill-panel.tsx` | fork/i18n |
| B6 | AgentsSettings `agents.newAgent` key missing → raw key on "New Agent" button (5 AgentsSettingsPage tests cascade) | add `agents.newAgent: "New Agent"` | fork/i18n-locales (en+ru) |
| B7 | `defaultModelsVersion` NOT bumped after full catalog swap → silent multi-device sync failure (reconcileDefaults + models snapshot) | bump `defaultModelsVersion` 3→4 in `shared/defaults/models.ts` | branch that swapped catalog (TBD — likely fork/additive) |

New locale keys to add (en + ru):
- `chat.json` errors: attestation/timeout/provider/network/connectionLost — English from `git show origin/main:src/components/chat/error-message.tsx`.
- `chat.json` sources.viewSources: "View {{count}} sources: {{name}} and {{remaining}} more".
- `settings.json` skills.slug: "Slug"; agents.newAgent: "New Agent".

### CATEGORY C — genuinely stale tests / locales (app is correct)
Fix by updating the test assertion OR restoring the upstream string in the EN catalog.

| Cluster | Fix | Branch |
|---|---|---|
| i18n init, account-deleted, model card, onboarding-privacy, agent-selector: assert "Thunderbolt" (5+) | update assertion → "Volt" | test-only (fork/dev) |
| CLI tests (5) | add `import '@/i18n/i18n'` + Volt literals + `installedTo` template | test-only, i18n-aware branch (fork/i18n-locales or fork/dev) |
| Casing: "Add agent"/"Add server"/"Add Models" (agent-selector, header, create-agent-detail, connections, chat-model-picker — ~9) | RESTORE upstream title-case in EN catalog ("Add Agent"/"Add Server"/"Add Model") → fixes tests + UX consistency, no test edits | fork/i18n-locales |
| Model Profiles DAL (3) + reconcileDefaults (1) | catalog swapped to free-tier OpenRouter; repoint tests from Opus48/GLM52 to a fork default | test-only (fork/dev) |
| WaitlistPage (1) | update `toHaveClass` to new classes; VERIFY mobile centering not regressed | test-only |
| acp: buildPromptBlocks (7) + connectAcpAdapter (1) | wrap first-text-block expectations with `ZEROCLAW_DELIVER_CITE_NOTE` prefix (`withCiteNote`); the always-on cite note is intentional | acp branch (fork/hooks/additive) |

### CATEGORY D — intra-file test pollution (NOT a bug, app works) — ~18+
**OnboardingLocationStep**: every subtest PASSES alone (`-t`) but the full file
fails 18/27. Order-dependent WITHIN the file — a fake-timer×waitFor×i18n
interaction (the fork's i18n re-render adds an async tick; an earlier test leaks
a pending poll that starves later tests' `waitFor`). `initImmediate:false` does
NOT fix it (tested: 87→85). CATEGORY A guard stops the throw but not the
timeout. This is TEST-INFRA debt, not a shipped defect. Likely other component
clusters (skills-view, connections, agents-settings component tests) have a
pollution component too — re-verify each with `-t` single-test vs full-file.
FIX DIRECTION: proper test isolation (await all renders/interactions; reset the
clock/i18n between tests) OR a global afterEach that drains pending @testing-
library polls before uninstall. Deferred / needs its own investigation.

## Execution model
Local commits per branch, ONE final `rebuild-master.ps1` (HUSKY=0), then full
suite on assembled master. No push (user will /thunderpush when green). Verify
Category B by running each affected file with `-t` (single test) + full file.
