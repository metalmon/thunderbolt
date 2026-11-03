---
name: thunder-push
description: Stage, commit and push changes in Thunderbolt as one atomic conventional commit - the only sanctioned way to git add, commit or push here. Use whenever work needs committing or pushing.
---

Stage, commit (atomic, conventional) and push the current changes.

The text after the skill name is guidance for the commit message. It may also name a target checkout (an absolute worktree path); then run every git command below as `git -C <path> ...`.

**Read [commit-conventions.md](references/commit-conventions.md) before writing the message.** It holds the format, the types, the `fix:` rule and examples.

## Steps

1. **Inspect**: `git status` (never `-uall`), `git diff --staged`, `git diff`, and `git log --oneline -5` to match the repo's style.
2. **Stage by name**: add each relevant changed or untracked file by path; `git add -A` and `git add .` stay out. Leave out files holding secrets (`.env`, credentials, keys).
3. **Write the message** per the conventions: `type(THU-123): subject` with a Linear ticket, `type: subject` without one, subject under 72 characters, a bullet body when the change is non-trivial.
4. **Commit** with a HEREDOC:

   ```bash
   git commit -m "$(cat <<'EOF'
   type: subject line

   - detail if needed
   EOF
   )"
   ```

5. **Push** — see **Pushing in this fork** below. It replaces that rule, not supplements it: in this repository `origin` is upstream and must never be written to.
6. **Verify**: `git status` shows a clean state after the push.

## Rules

- One atomic commit per invocation. When the changes span unrelated concerns, ask the user (in chat, and wait) whether to split them.
- Every commit is new: no amend, no `--no-verify`. If a pre-commit hook fails, fix the cause and commit again.
  Exception: on a `fork/*` patch branch the user has standing permission for `git commit --amend`, and the
  force-with-lease pushes below are prescribed rather than exceptional.

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
