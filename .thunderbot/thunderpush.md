---
context: fork
description: 'Stage, commit, and push changes'
---

For the full commit formatting reference, read `.thunderbot/references/commit-conventions.md`.

Stage, commit (atomic, conventional), and push all current changes.

## Steps

1. **Inspect changes** — run `git status` (never use `-uall`) and `git diff --staged` / `git diff` to understand what changed. Also run `git log --oneline -5` to match the repo's commit style.

2. **Stage files** — add all relevant changed/untracked files by name. Never use `git add -A` or `git add .`. Never stage files that contain secrets (`.env`, credentials, keys).

3. **Write a conventional commit message** — use the format `type: short description` where type is one of: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`, `ci`, `build`. Use `fix` only for bugs that existed before the current branch (i.e., bugs present on main). For fixing something you broke or introduced on the current branch, use `chore`, `refactor`, or the type that matches the original change. If the changes relate to a Linear ticket (e.g., `THU-123`), include it: `feat(THU-123): short description`. Keep the subject under 72 characters. Add a body with bullet points if the change is non-trivial. Focus on the "why", not the "what".

4. **Commit** — use a HEREDOC for the message:

   ```bash
   git commit -m "$(cat <<'EOF'
   type: subject line

   - detail if needed
   EOF
   )"
   ```

5. **Push** — see **Pushing in this fork** below. It replaces upstream's rule, not supplements it: in this repository `origin` is upstream and must never be written to.

6. **Verify** — run `git status` after push to confirm clean state.

## Rules

- One atomic commit per invocation. If changes span unrelated concerns, ask the user whether to split into multiple commits.
- Never amend existing commits, except on a `fork/*` patch branch, where the user has standing permission for `git commit --amend`.
- Never force push except as **Pushing in this fork** prescribes, and never with a bare `--force`.
- Never skip pre-commit hooks (`--no-verify`).
- If a pre-commit hook fails, fix the issue and create a new commit (don't amend).
- If `$ARGUMENTS` contains text, use it as guidance for the commit message.

## Pushing in this fork

Two remotes, and they are not interchangeable:

- `fork` → `metalmon/thunderbolt`, ours. Everything is pushed here.
- `origin` → `thunderbird/thunderbolt`, upstream. **Read-only. Never push to it**, with or without force, not even `main`.

Upstream's "push to the tracking branch, else `-u origin`" cannot apply: a tracking ref
can be absent or stale, and the fallback names the wrong repository. Name the remote and
the ref explicitly, every time.

What each ref takes:

| Ref      | How                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`   | Plain `git push fork main`. Pristine upstream mirror, fast-forward only — a rejection means it is not a mirror any more, so stop and find out why. |
| `fork/*` | `git push --force-with-lease fork fork/<a> fork/<b> …` — exactly this argument order.                                                              |
| `master` | `git push --force-with-lease fork master`, and **ask the user first**: their standing permission covers `fork/*` only.                             |

A rewrite is the normal state, not an accident: every upstream sync rebases the patch
branches and reassembles `master` from them, so their histories are replaced by design.
That is why the lease matters and the bare `--force` does not belong here — the lease is
what still catches a push racing someone else's.

`git fetch fork` **before** the push, never between reading the remote state and pushing
it: the lease is checked against the remote-tracking ref, so a fetch in between silently
relicenses whatever arrived meanwhile.

Push order when a sync lands: `main`, then the patch branches, then `master`. Assembly is
derived from the branches, so a `master` that arrives first names commits the remote does
not yet have.
