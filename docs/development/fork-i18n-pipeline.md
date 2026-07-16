# Fork i18n rebuild pipeline

This fork layers UI internationalization (`en`/`ru`) on top of upstream Thunderbolt using a **cherry-pick stack** instead of a long-lived merge branch. The rebuild script assembles a deployable `master` from upstream plus single-concern feature branches.

## Remotes

| Remote | Repository | Role |
|---|---|---|
| `origin` | [thunderbird/thunderbolt](https://github.com/thunderbird/thunderbolt) | Upstream; source of truth for product code |
| `fork` | [metalmon/thunderbolt](https://github.com/metalmon/thunderbolt) (or your fork) | Where fork branches and rebuilt `master` are pushed |

Configure once if needed:

```bash
git remote add origin https://github.com/thunderbird/thunderbolt.git
git remote add fork   https://github.com/metalmon/thunderbolt.git
```

## Branch model

| Branch | Purpose |
|---|---|
| `main` | Pristine mirror of `origin/main`. Fast-forward only. **Never commit product work here.** |
| `fix/make-format-windows` | Windows `make format` cargo detection fix; first stack entry, independent of i18n. |
| `feat/i18n-infra` | Core i18n plumbing: helpers, i18next init, `ui_language` setting, provider, rebuild script, docs. |
| `feat/i18n-wrap-*` | One branch per UI surface; each replaces hardcoded English with `t()` calls and grows `locales/en/*.json`. |
| `local/i18n-locales` | Russian (`ru`) catalog completion only - no wrap or infra code changes. |
| `master` | **Build and deploy this.** Ephemeral assembly: `main` + cherry-pick of every branch in `$Branches`. Push to `fork master`. |

Wrap branches are intentionally **narrow**: each should contain only the string-wrapping work for its namespace (settings, chat, auth, onboarding, tasks). Infra stays on `feat/i18n-infra`; translations stay on `local/i18n-locales`.

Current stack (order matters - listed in `dev-local/rebuild-master.ps1`):

1. `fix/make-format-windows` (cherry-pick `main..branch`)
2. `feat/i18n-infra` (cherry-pick `main..branch`)
3. `feat/i18n-wrap-settings` (cherry-pick `feat/i18n-infra..branch` - wrap delta only)
4. `feat/i18n-wrap-chat` (same infra-tip range)
5. `feat/i18n-wrap-auth`
6. `feat/i18n-wrap-onboarding`
7. `feat/i18n-wrap-tasks`
8. `local/i18n-locales` (same infra-tip range - locale commit(s) only)

## Rebuilding `master`

From the repo root:

```powershell
pwsh dev-local/rebuild-master.ps1
```

What it does:

1. Fetches `origin` and `fork`.
2. Fast-forwards local `main` to `origin/main`.
3. Resets `master` to `main`.
4. Cherry-picks each entry in `$Branches`, in order:
   - `fix/make-format-windows` and `feat/i18n-infra`: `main..<branch>`
   - each `feat/i18n-wrap-*` and `local/i18n-locales`: `feat/i18n-infra..<branch>` (avoids re-applying infra commits already picked)

On conflict, resolve files, run `git cherry-pick --continue`, then re-run the script.

When the rebuilt `master` looks good and tests pass, push to the fork:

```powershell
pwsh dev-local/rebuild-master.ps1 -Push
```

`-Push` runs `git push --force-with-lease fork master`. Only push after local verification - `master` is rewritten every rebuild.

## Adding a new `feat/i18n-wrap-*` branch

1. **Cut the branch** from `feat/i18n-infra` (or from `main` after infra is already in the stack - prefer branching from updated `feat/i18n-infra`).

   ```bash
   git checkout feat/i18n-infra
   git checkout -b feat/i18n-wrap-<surface>
   ```

2. **Wrap UI strings** for one surface: add keys to `locales/en/<namespace>.json`, replace JSX copy with `t('...')`. Follow the wrap procedure in the [UI i18n plan](../superpowers/plans/2026-07-15-ui-i18n.md).

3. **Commit and push** to `fork`:

   ```bash
   git push -u fork feat/i18n-wrap-<surface>
   ```

4. **Register the branch** in `dev-local/rebuild-master.ps1`: append to `$Branches` **after** `feat/i18n-infra` and **before** `local/i18n-locales`. Order among wrap branches should match dependency / conflict risk (settings before chat is the current convention).

5. **Rebuild** `master` locally and verify before pushing.

## Updating Russian on `local/i18n-locales`

Russian catalogs live on a dedicated branch so locale work never forces rebasing wrap branches.

1. Check out `local/i18n-locales` (branch from `feat/i18n-infra` if creating it fresh).

2. Edit **only** `locales/ru/**/*.json` - mirror every key from the matching `locales/en/**/*.json` files.

3. Commit and push:

   ```bash
   git add locales/ru
   git commit -m "feat(i18n): update Russian locale catalogs"
   git push fork local/i18n-locales
   ```

4. Re-run `pwsh dev-local/rebuild-master.ps1`. Cherry-pick replays locale commits on top of the wrap stack; wrap branches stay untouched.

When English keys change on a wrap branch, update `local/i18n-locales` in a follow-up commit on that branch - no need to rebase the wraps.

## When upstream lands i18n

Once Thunderbolt upstream merges equivalent i18n infrastructure and UI wrapping:

1. **Remove from `$Branches`:** `feat/i18n-infra` and every `feat/i18n-wrap-*` entry. Upstream `main` now carries that code.

2. **Keep or rehome locales:** If upstream ships `en` only, keep `local/i18n-locales` in `$Branches` until `ru` is upstream. If upstream absorbs `ru`, drop `local/i18n-locales` too.

3. **Retire fork branches** on `fork` after a successful rebuild confirms cherry-picks are no longer needed.

4. **Continue the model** for any remaining fork-only patches: add them to `$Branches` on their own single-concern branches - never on `main`.

## Rules

- **Never commit product work onto `main`.** It is a read-only mirror of `origin/main`.
- **One concern per branch.** Infra, each wrap surface, and locales are separate cherry-pick units.
- **Build from `master`.** After rebuild, run tests and spot-check UI before `-Push`.
- **Wrap branches push to `fork`;** upstream contributions go through normal PRs to `thunderbird/thunderbolt`.

## Related docs

- [UI i18n implementation plan](../superpowers/plans/2026-07-15-ui-i18n.md) - task breakdown, wrap file lists, DoD checklist.
- [UI i18n design spec](../superpowers/specs/2026-07-15-ui-i18n-design.md) - architecture and locked decisions.

