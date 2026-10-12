/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Straight from the Tauri API, not from `@/lib/platform`: that module reaches into
// the database layer, and importing it from the init path closes an import cycle that
// breaks unrelated tests. `platform.ts` reads `isTauri` from here too.
import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * Fork: mirror a boot-sequence line to the desktop process's stderr.
 *
 * The app already logs its init steps, but on Linux nobody can read them: Astra ships
 * no browser, and the WebKitGTK remote inspector speaks only WebSocket. Tauri's IPC
 * works there regardless, so the line goes out that way.
 *
 * Fire-and-forget by design. It must never throw, never reject, and never be awaited
 * on the boot path — a diagnostic that can delay or fail a launch is worse than no
 * diagnostic. On web (no Tauri) it is a no-op.
 */
export const forkBootLog = (line: string): void => {
  if (!isTauri()) {
    return
  }
  void invoke('fork_boot_log', { line }).catch(() => {
    // Swallowed on purpose: see above.
  })
}
