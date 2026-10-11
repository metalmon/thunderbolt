# Fork assembly and build pipeline

This fork layers its own features on top of upstream Thunderbolt using a
**cherry-pick stack** instead of a long-lived merge branch. The rebuild script
assembles a deployable `master` from upstream plus single-concern feature
branches; `master` is what gets built, tested, deployed and pushed.

> Formerly `fork-i18n-pipeline.md`. The i18next model it described was retired at
> 0.1.129 when the fork moved onto upstream's own Lingui (see `fork/lingui-ru`).

## Remotes

| Remote | Repository | Role |
|---|---|---|
| `origin` | [thunderbird/thunderbolt](https://github.com/thunderbird/thunderbolt) | Upstream (MPL-2.0); source of truth for product code |
| `fork` | [metalmon/thunderbolt](https://github.com/metalmon/thunderbolt) | Where fork branches and the rebuilt `master` are pushed |

Configure once if needed:

```bash
git remote add origin https://github.com/thunderbird/thunderbolt.git
git remote add fork   https://github.com/metalmon/thunderbolt.git
```

## Branch model

| Branch | Purpose |
|---|---|
| `main` | Pristine mirror of `origin/main`. Fast-forward only. **Never commit product work here.** |
| `fork/*` | Single-concern patch branches, each based on `main`. |
| `master` | **Build and deploy this.** Ephemeral assembly: `main` + cherry-pick of every branch in `$ForkBranches`. Push to `fork master`. |

## License boundary — additive vs invasive

Upstream is **MPL-2.0** (file-level copyleft). Every change is exactly one of:

- **Additive (our IP):** NEW files only, under our license header, in `src/fork/**`,
  `zeroclaw-integration/**`, the RU locale catalogs, and fork docs. Never edits an
  upstream file; relicensable / commercializable later.
- **Invasive (MPL):** edits to existing upstream files. Keep to the **absolute
  minimum** — one import plus one call. This is the only surface that conflicts
  when upstream advances.

**Rule:** never put fork logic inside an upstream file. Add a thin seam and
implement the logic in `src/fork/**`.

## Branch list and apply order

`dev-local/fork-branches.ps1` is the **single source of truth** for the branch
set and its apply order. Edit that list — not `rebuild-master.ps1` — when the set
changes. Order matters (later branches build on earlier ones):

1. `fork/additive` — new fork-owned files (`src/fork/zeroclaw/**`,
   `zeroclaw-integration/**`); never conflicts.
2. `fork/rebrand` — Thunderbolt → Volt/Вольт in visible strings, bundle identity,
   updater channel.
3. `fork/lingui-ru` — the fork's i18n on upstream's Lingui: adds the RU catalog,
   edits the `src/i18n` registry, and restricts the OFFERED/negotiable set to
   `en`/`ru` (other catalogs stay shipped for type compatibility but are never
   activated). Retired i18next branches `fork/i18n` + `fork/i18n-locales` (frozen
   at 0.1.124) are archaeology only.
4. `fork/hooks` — thin import-plus-call seams in upstream files: ZeroClaw wiring
   and the acp-stop-busy fix (MPL, invasive). All ZeroClaw behaviour lives in
   `fork/additive`'s files.
5. `fork/voice-gemini-live` — adds only the Gemini Live engine into upstream's
   voice router + backend relay route + `voice.tsx` seams.
6. `fork/anon-agent-manage` — relaxes custom-agent management for anonymous
   (local-only) accounts; self-contained, removable.
7. `fork/sandbox-host` — `frame-src` in the Tauri CSP; own-CSP origin for
   sandboxed artifact HTML.
8. `fork/spinner` — swaps lucide `Loader2` for the Volt `<Spinner>` (build alias).
9. `fork/perf` — GPU-smooth panel/overlay animation tweaks.
10. `fork/chat-scroll` — hold the last-message viewport reserve after settle.
11. `fork/hide-integrations` — TEMPORARY, removable: hides Google/Microsoft
    integrations until the backend has OAuth creds.
12. `fork/docx-viewer` — paginated docx-preview renderer instead of upstream's
    mammoth-in-iframe.
13. `fork/perm-title-interim` — localizes the "Approve {tool}?" title; self-
    disables once ZeroClaw localizes.
14. `fork/dev` — local dev/build fixes + fork tooling and docs; applied last so
    its overrides win.

Per-branch apply-order rationale lives as comments in
`dev-local/fork-branches.ps1`.

## Rebuilding `master`

From the repo root:

```powershell
pwsh dev-local/rebuild-master.ps1
```

What it does:

1. Fetches `origin` and `fork`.
2. Fast-forwards local `main` to `origin/main`.
3. Resets `master` to `main`.
4. Cherry-picks each entry in `$ForkBranches`, in order (`git cherry-pick main..<branch>`).
   Every active branch is a main-range branch; the old stacked exception
   (`fork/i18n-locales` on `fork/i18n`) retired with the i18next branches.
5. Regenerates `bun.lock` against the assembled `package.json` and commits it —
   the lockfile is an **assembly artifact** (deps arrive from several branches), so
   no single branch carries a complete, `--frozen-lockfile`-installable lock.

Handling during the cherry-pick:

- Git hooks are disabled for every subprocess (`HUSKY=0` plus transient
  `GIT_CONFIG_*` overriding `core.hooksPath`), so lint-staged never reformats the
  tree mid-rebuild.
- Conflicts are resolved once and replayed automatically by `rerere`
  (`rerere.autoupdate` stages the resolution). A pick whose change is already
  present higher in the stack is skipped as empty.
- An **unrecorded** conflict stops the script for a human: resolve, `git add`
  the files, `git cherry-pick --continue`, then re-run — `rerere` records the
  resolution so the next rebuild replays it.

When the rebuilt `master` looks good and tests pass, push to the fork:

```powershell
pwsh dev-local/rebuild-master.ps1 -Push
```

`-Push` runs `git push --force-with-lease fork master`. Only push after local
verification — `master` is rewritten every rebuild.

Required one-time git config per clone (prevents phantom CRLF churn that jams
checkouts/rebuilds, and makes rerere effective):

```bash
git config core.autocrlf false
git config core.eol lf
git config rerere.enabled true
git config rerere.autoupdate true
```

## Adding a new fork branch

1. **Cut the branch** from `main`:

   ```bash
   git checkout main
   git checkout -b fork/<concern>
   ```

2. **Keep one concern per branch.** Additive (new files) or invasive (thin
   import-plus-call seam). Push to `fork`:

   ```bash
   git push -u fork fork/<concern>
   ```

3. **Register the branch** in `dev-local/fork-branches.ps1` — append to
   `$ForkBranches` (and `$ForkMainRangeBranches`) in the position the apply order
   requires. Content-editing branches go near the end; `fork/dev` stays last.

4. **Rebuild** `master` locally and verify before pushing.

## Updating Russian

The RU catalog lives on `fork/lingui-ru` and is refreshed with the standard Lingui
flow, not by hand:

```bash
bun run i18n:extract   # extract + brand-swap catalogs + compile backend
bun run i18n:check     # CI gate — fails on stale catalogs
```

`i18n:extract` also runs `dev-local/i18n-brand-swap.mjs` (Thunderbolt → Volt in
catalogs) and compiles the backend email catalog. Commit both `src/locales` and
`backend/src/emails/locales`; the rebuild picks the branch up like any other.

## Upstream sync workflow

1. `git fetch origin --prune`
2. `pwsh dev-local/fork-upstream-impact.ps1` — reports which fork branches touch
   files upstream changed since each branch's base.
3. Rebase only the flagged branches onto `origin/main`; resolve conflicts once
   (`rerere` caches them). `fork/lingui-ru` is the primary rebase-forward target,
   since it edits upstream's locale registry.
4. `pwsh dev-local/rebuild-master.ps1` to reassemble `master`; build and verify.

## Building

Frontend (Vite):

```bash
bun install
bun run build          # production web build
bun run tauri:dev:desktop   # Tauri desktop dev (src-tauri/tauri.dev.conf.json)
```

Product identity lives in `src-tauri/tauri.conf.json` (`productName: "Volt"`,
`identifier: ru.metalmon.volt`); the fork's own Tauri/Tauri-bundle overrides
(NSIS installer branding, updater channel, CSP) ride `fork/dev`,
`fork/sandbox-host` and `fork/rebrand`.

Verify before pushing a rebuilt `master`:

```bash
bun run check     # type-check + lint + format-check + license headers
bun run test      # scoped unit tests (NOT bare `bun test` at the root)
```

Desktop **release** is a `workflow_dispatch` of
`.github/workflows/desktop-release.yml` (inputs: `version`, `nightly`). It builds
the platform bundles (deb/AppImage/rpm/nsis) and uploads via
`crabnebula-dev/cloud-release` against `metalmon/thunderbolt`.

## On-prem pilot backend

The self-hosted pilot stack (Keycloak realms, PowerSync/Postgres config, nginx TLS
terminator, `voltd` auto-discovery) is authored on `fork/dev` under
`dev-local/pilot-kit/`. It is refreshed with `dev-local/pilot-kit-sync.ps1` /
`dev-local/pilot-kit-refresh.ps1`.

## When upstream absorbs a fork feature

1. **Remove the branch** from `$ForkBranches` (and `$ForkMainRangeBranches`) in
   `dev-local/fork-branches.ps1` once upstream `main` carries equivalent code.
2. **Rebuild** and confirm the cherry-pick no longer adds anything (the branch
   now picks empty and is skipped automatically).
3. **Retire the branch** on `fork` after a successful rebuild confirms it is no
   longer needed.
4. **Continue the model** for remaining fork-only patches: add each on its own
   single-concern branch — never on `main`.

## Rules

- **Never commit product work onto `main`.** It is a read-only mirror of
  `origin/main`.
- **One concern per branch.** Each branch is a separate cherry-pick unit.
- **Build from `master`.** After a rebuild, run tests and spot-check the UI before
  `-Push`.
- **Fork branches push to `fork`;** upstream contributions go through normal PRs
  to `thunderbird/thunderbolt`.

## Related docs

- `AGENTS.md` — fork maintenance rules (license boundary, thin-hook rule, Windows
  environment, i18n override).
- `dev-local/fork-branches.ps1` — canonical branch list + apply order (comments).
