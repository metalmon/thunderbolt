# RESUME: upstream sync onto v0.1.110 (origin/main @ a8ae4b03)

Paused mid-sync (session limits). State is CLEAN and resumable. rerere holds ~50 recorded
conflict resolutions that replay automatically on re-run.

## What upstream shipped (why it's big)
- `feat(design): redesign (#1095)` — big redesign → touched the same components fork/i18n t()-wraps
  (79-file collision) AND introduced a new heading font.
- MAJOR dep bumps: bson 6→7, astro 7, exa-js 2. Minor: @powersync/web 1.38→1.39 (+ common/tanstack/drizzle),
  many @radix-ui/*, pi-* 0.80.7. Added @fontsource-variable/mozilla-headline (heading font), @storybook/addon-themes.

## Current branch state (git rev-list --left-right --count origin/main...<b>)
- fork/additive     0 / 5   → ALREADY REBASED onto origin/main (done)
- fork/i18n         8 / 25  → NOT rebased (aborted; re-run rebase, rerere replays)
- fork/i18n-locales 8 / 28  → NOT rebased (stacks on fork/i18n)
- fork/hooks        8 / 7   → NOT rebased (collisions: acp-adapter.test.ts, source-card.tsx, preferences.tsx, tauri.conf.json)
- fork/dev          8 / 21  → NOT rebased (collisions: app.tsx, tauri.conf.json, capabilities/default.json, desktop-release.yml, AGENTS.md)
- tunnel POWERSYNC_URL override is STASHED (git stash list → "local tunnel POWERSYNC_URL override"). Do NOT commit it.

## RESUME STEPS (in order)
1. `git fetch origin --prune` (confirm origin/main still a8ae4b03; if moved, re-run impact script).
2. Rebase each branch onto origin/main IN THIS ORDER (rerere auto-resolves recorded ones):
   `git checkout fork/i18n && git rebase origin/main`  (25 commits; rerere replays. Resolve any NEW stops.)
   then fork/i18n-locales (stacks on fork/i18n — rebase onto origin/main too), fork/hooks, fork/dev.
   Conflict rule everywhere: keep upstream (HEAD) structure/logic + re-apply fork's t()/translateDefaultField
   wraps; both-added imports → keep both.
   - package.json conflict: keep upstream bumps + re-add i18next deps.
   - bun.lock conflict: `git checkout --ours bun.lock && git add bun.lock` (do NOT hand-merge; bun install fixes it later).
3. settings-sidebar.tsx (already resolved once, in rerere): upstream rewrote it into data-driven navGroups.
   Resolution = take upstream structure, i18n via labelKey + t(). NEW i18n keys still needed in
   fork/i18n-locales (locales/{en,ru}/settings.json `sidebar` block):
     sidebar.groupAgents      EN "Agents"          RU "Агенты"
     sidebar.groupAgentTools  EN "What agents use" RU "Что используют агенты"
     sidebar.groupSettings    EN "Settings"        RU "Настройки"
     sidebar.allAgents        EN "All agents"      RU "Все агенты"
4. FONT (Merriweather — user approved; replaces --font-heading for Cyrillic). On fork/dev:
   - Mozilla Headline (upstream --font-heading) is LATIN-only (verified), no Cyrillic. Only affects DISPLAY
     headings (empty-chat greeting). Merriweather CONFIRMED cyrillic, OFL.
   - Prepared woff2 (2.4MB, variable wght 300-900 + opsz): scratchpad of the paused session had it; if gone,
     regenerate from `E:\Шрифты Claude\Merriweather\Merriweather-VariableFont_opsz,wdth,wght.ttf` via:
     python: TTFont(src); f.flavor='woff2'; f.save(out)  (needs `pip install brotli`).
   - Place woff2 as fork asset (e.g. src/fork/fonts/ or public/fonts/), add @font-face
     (font-family:'Merriweather Variable'; font-weight:300 900), override in src/index.css @theme:
     `--font-heading: 'Merriweather Variable', ui-serif, Georgia, serif;`  (NOTE: serif — deliberate).
   - Decide: keep or drop upstream `@import '@fontsource-variable/mozilla-headline'` (unused after override).
5. `pwsh dev-local/rebuild-master.ps1` (assembles master; rerere replays).
6. `bun install` (MANDATORY — new deps + regenerate bun.lock).
7. Verify `powersync-web-internal` alias in vite.config.ts still resolves `@powersync/web/lib/src` (CLAUDE.md warning).
8. `bun run type-check` (watch bson 7 / astro 7 breaking usage) + targeted tests (fork/zeroclaw, acp, reasoning, assistant-message).
9. Build binary: `bun run tauri build --no-bundle --features native_fetch` (stop running thunderbolt.exe first).
10. Push: fork/additive fork/i18n fork/i18n-locales fork/hooks fork/dev (force-with-lease as needed) + master (force).

## Notes
- proxy tooltip: preferences.tsx ~165 proxyTooltipReason left upstream-English (relocated out of conflict) — minor gap.
- Full working notes also in the paused session's scratchpad sync-notes.md (may be cleaned).
