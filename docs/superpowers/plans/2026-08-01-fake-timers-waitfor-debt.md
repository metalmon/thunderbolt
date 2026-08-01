# Handoff: fake-timers × waitFor pre-existing test debt (~78 failures)

**Status:** characterized, NOT fixed — deferred 2026-08-01. Pre-existing (red
before the 2026-08 fork-sync/i18n work). See memory `fork-sync-0120-batch.md`.

## Symptom

Full assembled `master`, `bun test --cwd=src --timeout 5000` → **~78 fail /
~4176** (about 2%). **Order-dependent**: each failing test file **passes in
isolation** but fails inside the randomized full suite. Signature histogram:

- 22 × `error: Fake timers are not active. Call useFakeTimers() first.`
- 40 × `Unable to find …` (DOM text/label)
- 22 × `expect(received)` / `Received:` assertion mismatches

The 40 + 22 are **downstream cascades** of the 22 timer errors, not independent
bugs. Top clusters: OnboardingLocationStep (18), SkillsView state machine (8),
buildPromptBlocks (7), AgentsSettingsPage (6), ErrorMessage (5), ConnectionsPage
(5), AgentSelector (4), SkillForm (4), ThunderboltCli (5), ChatModelPicker (2),
CreateItemHost (1), plus singletons.

## Root cause (confirmed)

The global test preload installs sinon fake timers per-test and uninstalls them
in `afterEach`:

- `src/testing-library.ts:107` `beforeEach(() => { globalClock = installFakeTimers() })`
- `src/testing-library.ts:116` `afterEach(() => { … reset(); uninstall(); globalClock = null })`
- `src/test-utils/fake-timers.ts` — `installFakeTimers()` calls `@sinonjs/fake-timers` `install()` and rebinds `jest.advanceTimersByTime` etc. to closures over **that test's** clock (`jestGlobal.advanceTimersByTime = (ms) => clock.tick(ms)`).

`@testing-library/dom`'s `waitFor` polls fake timers:
`node_modules/@testing-library/dom/dist/wait-for.js:71` → `jest.advanceTimersByTime(interval)`.

When a `waitFor` poll loop **straddles the afterEach uninstall boundary** (an
**unawaited** render/interaction leaves a pending poll — e.g.
`onboarding-location-step.test.tsx` calls `renderComponent(...)` without
`await`), the next `advanceTimersByTime` calls `clock.tick()` on the
**uninstalled** clock → throws `Fake timers are not active` → the exception
**poisons** subsequent tests in the run. Randomize decides which file is
downstream, so the failing SET shifts run-to-run but the COUNT is stable.

### Exact stack

```
error: Fake timers are not active. Call useFakeTimers() first.
  at @testing-library/dom/dist/wait-for.js:71:16   // jest.advanceTimersByTime(interval)
  at @testing-library/react/dist/act-compat.js:47
  at react.development.js:814
  at @testing-library/dom/dist/wait-for.js:65
  at waitFor (wait-for.js:36)
  at src/testing-library.ts:49                      // configure({ asyncWrapper: async cb => await cb() })
```

Note `testing-library.ts:44-50` ALREADY tries to dodge this with
`configure({ asyncWrapper: async (cb) => await cb() })`, but that does **not**
stop `waitFor`'s internal `jestFakeTimersAreEnabled()` check from taking the
fake-timer branch.

## Why the attempted fix FAILED (don't repeat it)

Attempt (reverted, fork/dev `192a306a`→`d3e5c443`): wrap the shims in
`src/test-utils/fake-timers.ts` in try/catch so a dead-clock tick no-ops:
`jestGlobal.advanceTimersByTime = guard((ms) => clock.tick(ms))`.

- On **fork/dev's** smaller suite it showed 78→0 — a **FALSE POSITIVE** (fewer
  files + lucky randomize order, not the guard).
- On **master** (full suite): **78→78, zero effect.**

Conclusion: the `jest.advanceTimersByTime` that `waitFor` actually calls is
**NOT** the `globalThis.jest` shim we patch. Most likely `@testing-library`
resolves `jest` from bun's built-in `bun:test` `jest` object (or a module-level
capture), which our `globalThis.jest`/`global.jest` assignment does not affect —
so bun's own "fake timers not active" throw is never intercepted. Verify this
first.

## Fix directions to try (in order)

1. **Confirm the jest source.** Instrument `wait-for.js:71` (or a shim) to log
   `jest === globalThis.jest`, and check whether `@testing-library` imports jest
   from `bun:test`. Determine the exact object whose `advanceTimersByTime` runs.
2. **Make `waitFor` NOT detect fake timers** (cleanest, most likely correct).
   `waitFor` uses `jestFakeTimersAreEnabled()`. If it returns false, `waitFor`
   uses the real-timer/`asyncWrapper` path and never ticks. Options: don't expose
   the jest fake-timer shims that `jestFakeTimersAreEnabled` keys on, OR set the
   sinon `install({ toFake })` list so it doesn't look "jest-enabled", OR patch
   the detection. Risk: tests that legitimately drive `jest.advanceTimersByTime`
   in `waitFor` — audit those first (grep `advanceTimersByTime`/`getClock` in
   tests).
3. **Patch the real jest object.** If bun's `bun:test` `jest` is what runs, patch
   THAT (import `jest` from `bun:test` in the preload and guard/rebind its
   timer methods), not `globalThis.jest`.
4. **Fix the leak, not the symptom.** The true bug is unawaited renders leaving
   pending `waitFor` polls across `afterEach`. A global `afterEach` that drains/
   cancels pending @testing-library timers BEFORE `uninstall()` would remove the
   straddle. Investigate `waitFor`'s cleanup + whether an `await`-all or a
   `cleanup()`-before-uninstall ordering helps.
5. Consider whether upstream (thunderbird/thunderbolt) has the same failures —
   if upstream's suite is green, diff their `testing-library.ts`/`fake-timers.ts`
   against ours (ours is fork-authored i18n-init aside; `fake-timers.ts` is
   upstream and untouched by the fork).

## How to measure

```
# authoritative count + per-failure detail (ANSI-stripped so it's parseable):
bun test --cwd=src --timeout 5000 2>&1 | sed -E 's/\x1b\[[0-9;]*m//g' > /tmp/run.txt
grep -c "Fake timers are not active" /tmp/run.txt        # the root count
grep -E "^\s*[0-9]+ (pass|fail)" /tmp/run.txt | tail -2   # totals
```
`bun run test` (the package script) prints ONLY the total, no per-failure
detail — always use `bun test --cwd=src` for triage. A file passing alone but
failing in-suite ⇒ it's a downstream victim, not the culprit.

## Guardrails

- These 78 are PRE-EXISTING; do not attribute them to the voice/i18n/sync work.
- The i18n-init fix (`fork/i18n` testing-library.ts `import '@/i18n/i18n'`) and
  the missing-EN-keys fix (`fork/i18n-locales`) are CORRECT and unrelated — keep.
- `fake-timers.ts` is upstream/untouched by the fork; a fix there is a new
  invasive edit → `fork/dev` (dev/test tooling). Re-stack i18n-locales onto
  i18n only if you touch i18n; a fake-timers.ts change on fork/dev needs no
  re-stack.
