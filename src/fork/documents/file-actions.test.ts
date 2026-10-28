/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). See ./file-actions.ts. */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canOpenNatively, downloadAndOpenNatively } from './file-actions'

// No module mocks here on purpose: bun's `mock.module` is process-global and would
// leak into save-file.test.ts (which tests the real `saveBlobUrl`). The native-open
// path short-circuits on the platform gate before touching blob storage or Tauri, so
// it's fully testable off-desktop without mocking anything. The `downloadStoredFile`
// glue (getAttachment -> objectURL -> saveBlobUrl) is exercised via the render tests.
describe('file-actions native-open gate', () => {
  it('canOpenNatively is false off Tauri desktop (the test env)', () => {
    expect(canOpenNatively()).toBe(false)
  })

  it('downloadAndOpenNatively resolves to false off Tauri desktop, without writing or opening', async () => {
    expect(await downloadAndOpenNatively('f1', 'x.pdf')).toBe(false)
  })
})

// Asserted on the source, not through a mocked `invoke`: the comment above
// explains why this file takes no module mocks, and the invariant is about what
// the call site may contain, which the source states directly.
describe('the webview never names a save destination', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'file-actions.ts'), 'utf-8')

  // The destination comes from the dialog inside the Rust command. Passing a path
  // (or raising the dialog here and passing its result) puts the write target back
  // under the webview's control, and that command writes outside the `fs` plugin's
  // scopes and then launches the file.
  it('passes no path to the save command', () => {
    const call = source.match(/invoke<boolean>\('save_document_as',[^)]*\)/)
    expect(call).not.toBeNull()
    expect(call?.[0]).not.toContain('path')
  })

  it('raises no save dialog of its own', () => {
    expect(source).not.toContain('@tauri-apps/plugin-dialog')
  })
})
