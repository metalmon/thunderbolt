/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Reads a source file by its path from the repository root, for the handful of
 * fork tests that assert a seam is still WIRED UP — that a component is mounted,
 * that a gate is read at the model-facing call site. Those facts have no runtime
 * surface to assert against: the app renders perfectly well with the banner
 * unmounted, and no other test would notice.
 *
 * ⚠ The path must not be relative to the CWD. The frontend runner starts with
 * `--cwd=src`, so `readFileSync('src/app.tsx')` resolves to `src/src/app.tsx`
 * and throws, while the same test passes when run from the repo root. Anchoring
 * on `import.meta.dir` makes the read independent of where bun was invoked.
 */
export const readRepoFile = (repoRelativePath: string): string =>
  readFileSync(join(import.meta.dir, '..', '..', '..', repoRelativePath), 'utf8')

const repoRoot = join(import.meta.dir, '..', '..', '..')

/**
 * Every source file under `repoRelativeDir`, as repository-relative paths with
 * forward slashes.
 *
 * For the one test that has to look at the WHOLE tree rather than a named file:
 * the autonomous-mode inventory, which fails when a new module starts talking
 * to our backend without saying what local mode does about it. Walking is the
 * point — an inventory you have to remember to update is the thing that failed.
 */
export const listRepoFiles = (repoRelativeDir: string, extensions = ['.ts', '.tsx']): string[] => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        return walk(full)
      }
      return extensions.some((extension) => entry.name.endsWith(extension)) ? [full] : []
    })
  return walk(join(repoRoot, repoRelativeDir)).map((file) => relative(repoRoot, file).split(sep).join('/'))
}
