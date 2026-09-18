/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). See ./file-actions.ts. */

import { describe, expect, it } from 'bun:test'
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
