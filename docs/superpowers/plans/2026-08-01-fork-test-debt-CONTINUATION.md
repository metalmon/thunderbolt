# Fork test-debt — CONTINUATION LEDGER (resume here)

**Read first:** memory `fork-test-debt-diagnosis`, and the analysis in
`2026-08-01-fork-test-debt-triage.md` (categories A–D + per-cluster recipes).
This file is the live state + exact remaining checklist.

## Current state (verified on assembled `master`, tsc 0 errors)

Full suite `bun test --cwd=src --timeout 5000 --randomize`:
**87→20 fail · 0 straddles · 4153 pass.** All Category A + B + **C** done
(master tip `916f274a`, verified 2026-08-02). Remaining 20 = Category D
pollution only (see below) — deferred to its own session.

### Commits landed — LOCAL ONLY, NOT PUSHED
| Branch | tip | contents |
|---|---|---|
| `fork/dev` | `e777d41d` | A: straddle guard + tsc cast (`c6ffcb98`). **C:** Volt rebrand test assertions (account-deleted, models/index, onboarding-privacy, agent-selector, routes/settings/agents `Open Volt`+heading+`always on hand` reword); CLI test `import '@/i18n/i18n'` + Volt literals + `installedTo` template; DAL repoints Opus48→Nemotron3Super (model-profiles, models auto-profile) + reconcileDefaults THU-637 generalised to `defaultModels[0]` |
| `fork/hooks` | `806b046e` | B7: `defaultModelsVersion` 3→4 (`a8fe8324`). **C:** acp `withCiteNote` — 7 first-block wraps in `acp-prompt-blocks.test.ts` + 1 in `acp-adapter.test.ts:499` |
| `fork/i18n` | `6df23289` | B1/B2/B3/B5 (`8c13dddf`). **C:** restore waitlist mobile-centering classes (`waitlist-page.tsx` — i18n migration collateral, regressed grouped centering) |
| `fork/i18n-locales` | `64e24627` | B4/B6 + chat errors/sources + slugError (`c6c113b4`). **C:** EN title-case restore `addAgent`(chat+settings)→"Add Agent", `addModels`(chat)→"Add Model", `addServerButton`→"Add Server"; `i18n.test.ts` appName→"Volt" |

⚠ `fork/i18n-locales` was **rebased** onto the new `fork/i18n` tip earlier, so its
commit hashes diverged from `origin fork/fork/i18n-locales` → push needs
`--force-with-lease`. Other branches are fast-forward pushes.

### ⚠ Branch topology note (missing from CLAUDE.md + earlier triage)
Assembly order is actually **`additive → fork/rebrand → i18n → i18n-locales →
hooks → dev`** — there is a **`fork/rebrand`** branch (tip `ecda6425`) that owns
the Thunderbolt→Volt rebrand (`agents.ts name:'Volt'`, `model-presentation.tsx`,
default-task "VoltPro", visible strings). The canonical list is in
`dev-local/fork-branches.ps1`. CLAUDE.md's branch list omits it. **Consequence:**
the app renders "Volt" only on assembled `master` — NOT on any single branch's
worktree. Verify all Volt/i18n test edits on assembled `master`, never on
`fork/dev` alone (dev has upstream `agents.ts name:'Thunderbolt'`, no locales).

## Environment & gotchas (all verified this session)

- **Worktrees in use** (scratchpad `C:\Users\bucher\AppData\Local\Temp\claude\C--dev-thunderbolt\685b4992-2f66-4aca-a577-9f7871df6ca1\scratchpad`): `i18n-wt`(fork/i18n), `i18nloc-wt`(fork/i18n-locales), `hooks-wt`(fork/hooks), `master-wt`(detached, experiments), `up-main`(origin/main control, 4110 pass/0 fail — proves upstream green on Windows). Each needs a `node_modules` **junction** to `C:\dev\thunderbolt\node_modules` (PowerShell `New-Item -ItemType Junction`). Clean up with `git worktree remove` when done.
- **Rebuild:** `HUSKY=0 pwsh -NoProfile -File dev-local/rebuild-master.ps1` — run **foreground** with `timeout 600000`; **background runs get killed mid-way**. It resets `master` to `main` and cherry-picks `$ForkBranches` (rerere auto-resolves). No build/tsc inside.
- **Committing on branches:** use `HUSKY=0 git commit …` — the husky hook runs `make format` over the whole tree and leaves ~29 unstaged modified files that **dirty the tree and break the next rebuild**. If it happens: `git restore .` + delete stray `NUL` (`cmd //c "del /f /q NUL"`).
- **git show/diff with `ref:path`:** prefix `MSYS_NO_PATHCONV=1` (Git Bash mangles the `:`).
- **Test paths** are relative to `src/` when using `--cwd=src` (e.g. `components/chat/error-message.test.tsx`, not `src/...`).
- **Pollution check:** run one test with `-t "<name>"`; passes alone but fails in-file ⇒ Category D pollution, not a real bug.
- **Verify i18n fixes** in `i18nloc-wt` (has i18n + EN/RU content) or on assembled `master` — NOT on `fork/i18n` alone (no locale content there).

## Remaining 20 = Category D pollution only (Category C DONE ✅)

Every remaining failure is intra-/cross-file test pollution: each passes in
isolation (`-t`) and each file passes alone, but they fail when interleaved
under `--randomize`. The victim set rotates by seed (`OnboardingLocationStep`
~18 always + one rotating extra — `ChatSkillsBar` / `AgentsSettingsPage` /
`parseMarkdownIntoBlocksIncremental` flake). **No shipped defect.** See
Category D below — needs its own isolation-debugging session.

### Newly observed (out of scope, for a future session)
- **Snapshot debt:** `bun test` reports "5 added" snapshots every run
  (`src/ai/streaming/__snapshots__/sse-logs.test.ts.snap` + others). Committed
  `.snap` files are missing entries the tests generate → auto-written locally
  (passes), but a `--ci` run would FAIL. Pre-existing; the stale loose entry had
  "Thunderbolt Pro" (pre-rebrand). Belongs on the branch owning the sse-logs
  test cases. Restore the loose `.snap` before each `rebuild-master`.

### Category C — stale tests — DONE ✅ (kept for reference)
All fixed + verified on assembled master. Recommended branch in ( ).

1. **Volt rebrand assertions** — update `Thunderbolt`→`Volt`:
   - `src/i18n/i18n.test.ts` "loads english common strings" → expect `'Volt'`.
   - `src/components/account-deleted.test.tsx` "renders Thunderbolt branding" → `'Volt'`.
   - `src/settings/models/index.test.tsx` "brands … as Thunderbolt" → `getByText('Volt')` (keep Tinfoil-absent assertion).
   - `src/components/onboarding/onboarding-privacy-step.test.tsx` `/Thunderbolt/`→`/Volt/`.
   - `src/components/agent-selector.test.tsx` (Volt part) → `'Volt'` (from `src/defaults/agents.ts` name).
   - (test-only → `fork/dev`; they need i18n content at runtime, which assembled master has.)
2. **Casing** — DECIDE once: restore upstream **title-case in the EN catalog** (fixes tests + UX consistency, no test edits) OR update tests to current lowercase copy. Upstream/tests want title case:
   - `chat.json agent.addAgent` "Add agent"→"Add Agent"; `settings.json agents.addAgent` "Add agent"→"Add Agent" (fixes agent-selector, header, create-agent-detail).
   - `chat.json model.addModels` "Add Models"→"Add Model" (fixes chat-model-picker ×2 — test wants singular).
   - connections submit button "Add server"→"Add Server" (fixes ConnectionsPage iroh ×4 + ordinary ×1). Find key in `src/settings/connections/*` / `mcp-server-form`.
   - (catalog fixes → `fork/i18n-locales`.)
3. **acp `withCiteNote`** (fork feature, always-on cite note is intended): wrap first-text-block expectations with `${ZEROCLAW_DELIVER_CITE_NOTE}\n\n` prefix.
   - `src/acp/acp-prompt-blocks.test.ts` — add `const withCiteNote = (b) => \`${ZEROCLAW_DELIVER_CITE_NOTE}\n\n${b}\`` (import from `src/fork/zeroclaw/zc-deliver-cite-note`), wrap the 7 first-block `.toBe/.toEqual`. Second blocks unaffected.
   - `src/acp/acp-adapter.test.ts:~508` — the one missed `sentPromptText(...)` assertion: wrap in `withCiteNote(...)` (siblings already use it).
   - (test-only; belongs with the acp hook → `fork/hooks` or `fork/additive`.)
4. **DAL catalog-swap repoint** (fork swapped catalog to OpenRouter free tier; Opus48/GLM52 demoted):
   - `Model Profiles DAL` (2) + `Models DAL` auto-profile (1): repoint from `defaultModelOpus48`/`defaultModelProfileOpus48` to a fork default (e.g. `defaultModelNemotron3Super` + its profile). Find test file under `src/dal/`.
   - `reconcileDefaults version gate (THU-637)` (1): test uses `defaultModelGlm52` (removed) → rewrite against a fork-catalog model that carries server-owned metadata.
   - (test-only → `fork/dev` or with the catalog on `fork/hooks`.)
5. **CLI tests** — `src/components/settings/agents/thunderbolt-cli.test.tsx` (ThunderboltCliRow ×3, ThunderboltCliDetail ×2): add `import '@/i18n/i18n'` at top (it never inits i18n), update literals to Volt ("Open Volt CLI", "Use Volt from the command line."), and match the `installedTo` template for the installed-path assertion.
6. **WaitlistPage** (1) "centers mobile code entry": update the two `toHaveClass(...)` to the new classes (fork changed `mt-auto…md:my-auto`→`my-auto`, dropped `mb-auto mt-8 md:mb-0 md:mt-0`). **VERIFY mobile still centers** — the fork dropped responsive spacing; if it regressed, fix the component instead.

### Category D — intra-file pollution (NOT shipped bug; app works)
- `src/components/onboarding/onboarding-location-step.test.tsx` (~15): each subtest PASSES alone (`-t`) but the file fails together. Component renders empty because an earlier test leaks a pending `waitFor` poll under fake timers (fake-timer×waitFor×i18n). `initImmediate:false` does NOT fix it (tested). Fix direction: proper isolation (await all renders/interactions; a global `afterEach` that drains/cancels pending @testing-library polls BEFORE the clock uninstall) OR give this file real timers. Needs its own debugging session; not blocking the real-bug work.

### Pre-existing flake (leave or quarantine)
- `parseMarkdownIntoBlocksIncremental > matches a full parse for randomly assembled documents streamed char-by-char`: randomized property test timing out ~5–6.5s vs 5s limit. Upstream markdown code, unrelated to fork. Consider raising its timeout or seeding it; not fork test-debt.

## Verify + finish
1. After any branch edits: `HUSKY=0 pwsh -NoProfile -File dev-local/rebuild-master.ps1` (foreground) → `bun run tsc --noEmit` (expect 0) → `bun test --cwd=src --timeout 5000 --randomize` (foreground; expect straddles 0, fail count ↓).
2. Then use `superpowers:finishing-a-development-branch` and push via the fork's flow (`--force-with-lease` for `fork/i18n-locales`). User controls push — nothing pushed yet.
