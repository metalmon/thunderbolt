# Localized Standalone Fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fork build that (a) never shows the "Wanna try the beta?" waitlist gate, (b) renders the pre-login UI in the OS locale (Russian on a Russian OS), and (c) rebuilds from upstream without stopping mid-way on already-resolved conflicts — all pointed at the user's self-hosted backend, not Thunderbird's cloud.

**Architecture:** Four independent changes. (1) Make the build-time env flags reliably present regardless of build cwd by committing a tracked `.env.production` on a fork patch branch (Vite inlines it at build for every checkout/worktree). (2) Seed i18next's initial language from the OS locale at init, so pre-auth chrome follows the OS before any account setting loads. (3) Fold rerere-aware auto-continue into the rebuild script so recorded conflict resolutions replay without a manual stop. (4) Verify/pin the backend URL so the app talks only to the self-hosted backend.

**Tech Stack:** Vite 8 (env inlining via `import.meta.env`), i18next + react-i18next, Tauri (desktop build), Git (cherry-pick + rerere), PowerShell (rebuild script).

## Global Constraints

- **Never commit product work to `main`** — `main` is a pristine ff-only mirror of `origin/main`. All fork changes live on `feat/*` / `local/*` patch branches that `dev-local/rebuild-master.ps1` cherry-picks onto `master`.
- **Env flags are non-secret** — `VITE_BYPASS_WAITLIST`, `VITE_AUTH_ENABLE_ANONYMOUS` are booleans; `VITE_THUNDERBOLT_CLOUD_URL` defaults to `http://localhost:8000/v1`. Safe to commit. No real secrets go into tracked env files.
- **Supported UI languages are exactly `'en' | 'ru'`** (`src/i18n/languages.ts`). Only Russian locales (`ru`, `ru-*`) select `ru`; everything else falls back to `en`.
- **Backend must be reachable** — the app needs the self-hosted backend on `:8000` for auth (even anonymous), PowerSync sync, and the LLM proxy. A down backend = black screen (see local build memory).
- **Desktop build command:** `tauri build --no-bundle --features native_fetch` (native_fetch avoids the anti-DPI proxy SSRF issue).

---

## File Structure

- `.gitignore` — carve out `.env.production` from the `.env*` ignore so the tracked fork env file is committable.
- `.env.production` (new, tracked on a fork branch) — build-time fork flags Vite auto-loads in production mode.
- `src/i18n/i18n.ts` — change the hardcoded `lng: 'en'` to detect from the OS locale at init.
- `src/i18n/i18n.test.ts` — add coverage that init language follows the client locale.
- `dev-local/rebuild-master.ps1` — enable rerere + auto-continue cherry-pick when rerere resolved all conflicts; fold in `_continue-rebuild.ps1` behavior.
- `dev-local/_continue-rebuild.ps1` — delete after folding its logic into the main script.

Which fork branch each change rides:
- `.env.production` + `.gitignore` carve-out → **`local/dev-fixes`** (fork-only build config; not upstreamable).
- `src/i18n/i18n.ts` + test → **`feat/i18n-infra`** (i18n behavior; the other i18n branches stack on it).
- rebuild script changes → **not a git branch** — `dev-local/` is untracked local tooling; edit in place on `master`/working tree.

---

## Task 1: Make fork env flags survive any build cwd

**Root cause (confirmed):** `dev-local/tauri-build.log:5` shows the last build ran from `C:\dev\thunderbolt\.worktrees\ui-i18n`. Vite loads `.env*` from the build cwd, and `.env` is git-ignored (`git check-ignore .env` → `.env`), so it did not exist in that worktree. Result: `VITE_BYPASS_WAITLIST`/`VITE_AUTH_ENABLE_ANONYMOUS` were `undefined` at build → `useAuthGate` fell through to `redirect → waitlist` → the English "Wanna try the beta?" screen. A tracked `.env.production` exists in every checkout/worktree and is auto-loaded by Vite in production builds, eliminating the fragility.

**Files:**
- Modify: `.gitignore` (carve out `.env.production`)
- Create: `.env.production`
- Reference (no edit): `src/lib/auth-mode.ts`, `src/components/auth-gate/use-auth-gate.ts:40`, `src/stores/local-settings-store.ts:24`

**Interfaces:**
- Consumes: Vite's env layering — in `--mode production`, Vite loads `.env` then `.env.production` (later wins), inlining `import.meta.env.VITE_*`.
- Produces: at build time, `import.meta.env.VITE_BYPASS_WAITLIST === 'true'`, `VITE_AUTH_ENABLE_ANONYMOUS === 'true'`, `VITE_THUNDERBOLT_CLOUD_URL === 'http://localhost:8000/v1'`.

- [ ] **Step 1: Switch to the fork branch that carries build config**

```bash
git checkout local/dev-fixes
```

- [ ] **Step 2: Carve `.env.production` out of gitignore**

Find the `.env` ignore line in `.gitignore` (currently ignores `.env`). Add an un-ignore line immediately after whatever ignores env files:

```gitignore
# Fork: track the non-secret production build flags (waitlist bypass, anonymous auth, backend URL)
!.env.production
```

Verify the pattern that ignores `.env` — if it is `.env*` the `!.env.production` negation is required; if it is a bare `.env` it already does not match `.env.production`, but add the negation anyway to be explicit and future-proof.

- [ ] **Step 3: Verify the carve-out works**

Run: `git check-ignore .env.production`
Expected: **no output** and exit code 1 (i.e. NOT ignored). If it prints `.env.production`, the negation line is missing or ordered before the ignore rule — fix ordering.

- [ ] **Step 4: Create the tracked fork env file**

Create `.env.production`:

```
# Fork production build flags — tracked so every checkout/worktree bakes them in.
# Non-secret. Point VITE_THUNDERBOLT_CLOUD_URL at your self-hosted backend.
VITE_THUNDERBOLT_CLOUD_URL="http://localhost:8000/v1"
VITE_AUTH_ENABLE_ANONYMOUS=true
VITE_BYPASS_WAITLIST="true"
```

- [ ] **Step 5: Confirm Vite inlines the flags**

Run (from repo root, production mode): `bun run build`
Then grep the built output for the baked flag:

Run: `grep -rl "Wanna try the beta" dist/ ; grep -roE "BYPASS_WAITLIST" dist/ | head`
Expected: the waitlist string may still be present in the JS bundle (the component is compiled in), but the gate logic is now driven by the baked `true`. The authoritative check is the runtime verification in Task 5 — the build succeeding without error is the gate here.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .env.production
git commit -m "chore(fork): track .env.production so waitlist bypass bakes into every build"
```

---

## Task 2: Seed initial UI language from the OS locale

**Why:** `src/i18n/i18n.ts:49` hardcodes `lng: 'en'`. The only OS-locale detection (`readClientLocale` → `resolveInitialUiLanguage`) is wired into `src/settings/preferences.tsx:275`, which runs **after login**. So waitlist/sign-in/onboarding are always English even though `ru/*.json` are complete. Seeding `lng` from `navigator.language` at init makes pre-auth chrome follow the OS; `UiLanguageSync` + preferences still override from the stored account setting post-login (account preference wins, which is correct).

**Files:**
- Modify: `src/i18n/i18n.ts:49`
- Test: `src/i18n/i18n.test.ts`
- Reference (no edit): `src/i18n/languages.ts` (`detectUiLanguage`)

**Interfaces:**
- Consumes: `detectUiLanguage(locale: string | null | undefined): 'en' | 'ru'` from `./languages` — returns `ru` only for `ru` / `ru-*`, else `en`.
- Produces: i18next initializes with `lng = detectUiLanguage(navigator.language)`; `setUiLanguage()` still overrides at runtime.

- [ ] **Step 1: Switch to the i18n infra branch**

```bash
git checkout feat/i18n-infra
```

- [ ] **Step 2: Write the failing test**

Add to `src/i18n/i18n.test.ts` (adjust import list to match the existing file top):

```ts
import { detectUiLanguage } from './languages'

describe('initial language from OS locale', () => {
  it('selects ru for a Russian OS locale', () => {
    expect(detectUiLanguage('ru-RU')).toBe('ru')
  })
  it('falls back to en for non-Russian locales', () => {
    expect(detectUiLanguage('en-US')).toBe('en')
    expect(detectUiLanguage(undefined)).toBe('en')
  })
})
```

Note: `i18n.ts` runs `init()` as an import side effect, so asserting the *actual* seeded `lng` in a unit test is brittle (jsdom `navigator.language` is fixed at import time). We assert the pure `detectUiLanguage` mapping here; the seeded value is verified end-to-end in Task 5.

- [ ] **Step 3: Run test to verify it passes for the helper (guards the mapping contract)**

Run: `bun test src/i18n/i18n.test.ts`
Expected: PASS (the helper already behaves this way; this locks the contract the init relies on).

- [ ] **Step 4: Change the init to detect the locale**

In `src/i18n/i18n.ts`, add the import near the other `./languages` import:

```ts
import { detectUiLanguage, normalizeUiLanguage, type UiLanguage } from './languages'
```

Replace line 49 (`lng: 'en',`) with:

```ts
  lng: detectUiLanguage(typeof navigator !== 'undefined' ? navigator.language : 'en'),
```

Leave `fallbackLng: 'en'` unchanged.

- [ ] **Step 5: Run the i18n suite**

Run: `bun test src/i18n/`
Expected: PASS — all existing tests plus the new block.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck` (or the project's tsc script)
Expected: no errors — `detectUiLanguage` already imported; `UiLanguage`/`normalizeUiLanguage` imports unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/i18n.ts src/i18n/i18n.test.ts
git commit -m "feat(i18n): seed initial UI language from OS locale for pre-auth screens"
```

---

## Task 3: Rebuild script — rerere auto-continue (no mid-way stop)

**Why:** The script stops on the `local/acp-citations-ref-map` → `src/acp/acp-adapter.ts` cherry-pick conflict (`dev-local/rebuild-master.log:71-81`). The correct fix is not skipping conflicts but recording their resolution once (`git rerere`) and auto-continuing the cherry-pick when rerere has resolved every conflicted path. Genuine, never-seen conflicts still stop with a clear message. This also folds `_continue-rebuild.ps1` into the main script so there is one entry point.

**Files:**
- Modify: `dev-local/rebuild-master.ps1`
- Delete: `dev-local/_continue-rebuild.ps1`

**Interfaces:**
- Consumes: `git config rerere.enabled true` (repo-local) so resolutions are recorded/replayed.
- Produces: a rebuild that pauses only on unrecorded conflicts; recorded ones auto-continue.

- [ ] **Step 1: Enable rerere for this repo**

```bash
git config rerere.enabled true
git config rerere.autoupdate true
```

`rerere.autoupdate` stages rerere-resolved files automatically, so the script only needs to detect "no conflicts remain" and continue.

- [ ] **Step 2: Replace the cherry-pick loop in `dev-local/rebuild-master.ps1`**

Replace the `foreach ($b in $Branches) { ... }` block (lines ~78-87) with a rerere-aware version:

```powershell
$env:GIT_EDITOR = "true"  # never open an editor on --continue

foreach ($b in $Branches) {
    $range = Get-CherryPickRange $b
    Write-Host "==> cherry-pick $range" -ForegroundColor Cyan
    git cherry-pick $range
    if ($LASTEXITCODE -ne 0) {
        # rerere (autoupdate) may have already resolved + staged every conflict.
        # If no unmerged paths remain, continue automatically; otherwise stop.
        $unmerged = git diff --name-only --diff-filter=U
        if ([string]::IsNullOrWhiteSpace($unmerged)) {
            Write-Host "    rerere resolved all conflicts for $b — auto-continuing" -ForegroundColor Yellow
            git add -A
            git cherry-pick --continue
            if ($LASTEXITCODE -ne 0) {
                Write-Host "!!! auto-continue failed on $b ($range)." -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "!!! unrecorded cherry-pick conflict on $b ($range):" -ForegroundColor Red
            Write-Host $unmerged -ForegroundColor Red
            Write-Host "    Resolve, run: git add <files>; git cherry-pick --continue" -ForegroundColor Red
            Write-Host "    rerere will record this resolution so the next rebuild replays it automatically." -ForegroundColor Red
            Write-Host "    Then re-run this script." -ForegroundColor Red
            exit 1
        }
    }
}
```

- [ ] **Step 3: Delete the now-redundant continue script**

```bash
rm dev-local/_continue-rebuild.ps1
```

- [ ] **Step 4: First run — record the resolution once**

Run: `pwsh dev-local/rebuild-master.ps1`
Expected: stops at the `acp-citations-ref-map` conflict with the "unrecorded conflict" message listing `src/acp/acp-adapter.ts`.

Resolve `src/acp/acp-adapter.ts` by hand, then:

```bash
git add src/acp/acp-adapter.ts
git cherry-pick --continue
```

rerere records the resolution on this step.

- [ ] **Step 5: Second run — verify no stop**

Run: `pwsh dev-local/rebuild-master.ps1`
Expected: at the same branch it prints `rerere resolved all conflicts for local/acp-citations-ref-map — auto-continuing` and the rebuild completes through all branches to `==> master rebuilt`.

- [ ] **Step 6: No commit needed for `dev-local/` (untracked)**

`dev-local/` is untracked local tooling. Nothing to commit for the script changes. If desired, note the change in `dev-local/rebuild-master.log` on the next run.

---

## Task 4: Verify standalone backend wiring (not tied to Thunderbird cloud)

**Why:** The default `cloudUrl` is already `http://localhost:8000/v1` (`src/stores/local-settings-store.ts:24`), NOT Thunderbird cloud — so by default the fork is not tied to their servers. This task confirms the baked build points only at the self-hosted backend and documents the requirement.

**Files:**
- Reference (no edit unless URL differs): `.env.production` (from Task 1), `src/stores/local-settings-store.ts:24`
- Modify (optional): `dev-local/` note or README documenting backend requirement

**Interfaces:**
- Consumes: `VITE_THUNDERBOLT_CLOUD_URL` baked from `.env.production`.
- Produces: a build whose `cloudUrl` resolves to the self-hosted backend for all auth/sync/proxy calls.

- [ ] **Step 1: Confirm the baked URL**

After Task 1's build, run: `grep -roE "http://localhost:8000/v1" dist/ | head`
Expected: at least one match (the URL was inlined). If the intended backend is not `localhost:8000`, update `VITE_THUNDERBOLT_CLOUD_URL` in `.env.production` and rebuild.

- [ ] **Step 2: Confirm backend reachability before launch**

Run: `curl -sS http://localhost:8000/v1/health || curl -sS http://localhost:8000/v1`
Expected: a response (not connection refused). If refused, start the self-hosted backend first — a down backend yields a black screen / auth failure, not the waitlist.

- [ ] **Step 3: No code commit** (verification-only task; any `.env.production` URL change was committed in Task 1's branch — amend/append there if edited).

---

## Task 5: End-to-end verification of the fork build

**Files:** none (verification only)

- [ ] **Step 1: Rebuild `master` with all patches**

Run: `pwsh dev-local/rebuild-master.ps1`
Expected: completes to `==> master rebuilt` with no mid-way stop (Task 3), and `master` now includes the Task 1 + Task 2 commits (via their patch branches).

- [ ] **Step 2: Build the desktop app from repo root**

Run (from `C:\dev\thunderbolt`, NOT a worktree): `tauri build --no-bundle --features native_fetch`
Expected: build succeeds; Vite loads `.env.production` (tracked) so bypass/anonymous/backend flags bake in regardless of cwd.

- [ ] **Step 3: Start the self-hosted backend** (if not already running) on `:8000`.

- [ ] **Step 4: Launch and verify the three fixes**

Launch the built app on a Russian-locale OS (or with `navigator.language = ru-RU`).
Expected:
1. **No "Wanna try the beta?" screen** — the app goes straight to an anonymous session / chat (Task 1).
2. **Russian pre-login UI** — any pre-auth chrome renders in Russian (Task 2).
3. **All traffic to localhost:8000** — check the network panel / logs show calls only to the self-hosted backend (Task 4).

- [ ] **Step 5: Record the result** in `dev-local/` (e.g. append to a build log) noting all three checks passed.

---

## Self-Review

**Spec coverage:**
- "Wanna try the beta?" blocks entry → Task 1 (root cause = worktree build without `.env`; fix = tracked `.env.production`) + verified in Task 5 Step 4.1.
- English splash despite RU translations → Task 2 (seed `lng` from OS locale) + verified in Task 5 Step 4.2.
- Not tied to their servers → Task 4 (default `localhost:8000/v1` confirmed baked) + verified in Task 5 Step 4.3.
- Rebuild script stops mid-way → Task 3 (rerere auto-continue) + verified in Task 5 Step 1.

**Placeholder scan:** No TBD/TODO; all code blocks concrete; commands have expected output.

**Type consistency:** `detectUiLanguage` / `normalizeUiLanguage` / `UiLanguage` names match `src/i18n/languages.ts`. `Get-CherryPickRange` reused from the existing script unchanged. Env var names match `src/lib/auth-mode.ts` and `src/stores/local-settings-store.ts` exactly.

**Open decision to confirm before execution:** Task 1 uses a tracked `.env.production` on `local/dev-fixes`. Alternative (if you would rather keep zero tracked env files): always build from the main repo root (never a worktree) and add a preflight assert in the build script that `.env` exists with the flags — less robust across worktrees but keeps env untracked.
