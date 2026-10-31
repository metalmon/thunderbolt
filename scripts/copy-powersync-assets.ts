/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Copies the `@powersync/web` browser assets into `destination`, safe for concurrent callers that share
 * one `node_modules`. Nothing is deleted and identical files are skipped. A changed file is staged in
 * `stagingDir` (same disk, outside `public/`) and renamed over the old one, so readers never see it torn.
 *
 * shortcut: files a newer @powersync/web no longer ships stay behind, so a stale copy can hide a renamed
 * worker in local dev; delete public/@powersync after an upgrade that renames or drops files.
 */
/**
 * Rename `from` over `to`, waiting out a reader that has `to` open.
 *
 * ⚠ Windows only looks like POSIX here. `rename` over an existing file is
 * atomic on both, but Windows refuses it outright — EPERM / EACCES / EBUSY —
 * while any other process has the destination open, and the readers this
 * routine exists to protect do exactly that. Upstream's own concurrency test
 * fails on Windows for this reason: all four child processes exit 1.
 *
 * The violation is transient, so the fix is to wait rather than to copy
 * non-atomically — a torn read is the thing we are avoiding.
 *
 * @param from - the staged file, already written in full
 * @param to - the published path readers watch
 */
const replaceWhenReadersAllow = (from: string, to: string) => {
  const retryCodes = new Set(['EPERM', 'EACCES', 'EBUSY'])
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt === 100 || !retryCodes.has(code)) {
        throw error
      }
      Bun.sleepSync(5)
    }
  }
}

export const copyPowerSyncAssets = (source: string, destination: string, stagingDir: string) => {
  const staged = path.join(stagingDir, `powersync-asset-${process.pid}.tmp`)
  mkdirSync(stagingDir, { recursive: true })
  for (const file of readdirSync(source, { recursive: true, encoding: 'utf8' })) {
    const from = path.join(source, file)
    if (!statSync(from).isFile()) {
      continue
    }
    const to = path.join(destination, file)
    const content = readFileSync(from)
    if (existsSync(to) && readFileSync(to).equals(content)) {
      continue
    }
    mkdirSync(path.dirname(to), { recursive: true })
    writeFileSync(staged, content)
    replaceWhenReadersAllow(staged, to)
  }
}
