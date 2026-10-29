/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
