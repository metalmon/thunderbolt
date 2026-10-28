/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { invoke } from '@tauri-apps/api/core'
import { getAttachment } from '@/lib/file-blob-storage'
import { isTauriDesktop } from '@/lib/platform'
import { saveBlobUrl } from './save-file'

/** Read a stored local file's blob, or null when it isn't in blob storage. */
const loadBlob = async (localFileId: string): Promise<Blob | null> => {
  const stored = await getAttachment(localFileId)
  return stored?.blob ?? null
}

/**
 * Save a stored local file to disk, prompting for a location where possible
 * (native "Save As" on desktop/Chromium, silent Downloads fallback elsewhere).
 * See {@link saveBlobUrl}. No-op when the file isn't in blob storage.
 */
export const downloadStoredFile = async (localFileId: string, filename: string): Promise<void> => {
  const blob = await loadBlob(localFileId)
  if (!blob) {
    return
  }
  const url = URL.createObjectURL(blob)
  try {
    await saveBlobUrl(url, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Whether {@link downloadAndOpenNatively} can run on this platform (Tauri desktop only). */
export const canOpenNatively = (): boolean => isTauriDesktop()

/**
 * Save a stored local file to a location the user picks, then open it with the OS
 * default application (Tauri desktop only — the sandboxed web build can neither
 * choose an arbitrary path nor hand a file to a native app).
 *
 * The dialog lives in the `save_document_as` Rust command, not here: this side
 * passes the bytes and a suggested NAME, never a path. It used to pass the path
 * the JS dialog returned, which made the destination a value from the webview —
 * and since the command writes outside the `fs` plugin's scopes and then launches
 * the result, any script running in the app origin could place an executable
 * anywhere and start it. Rust opens only the extensions on its allowlist and
 * reveals the rest in the file manager.
 *
 * @returns `true` once saved; `false` when unavailable, the user cancelled the
 *   dialog, or the file isn't in blob storage.
 */
export const downloadAndOpenNatively = async (localFileId: string, filename: string): Promise<boolean> => {
  if (!isTauriDesktop()) {
    return false
  }
  const blob = await loadBlob(localFileId)
  if (!blob) {
    return false
  }
  const contents = Array.from(new Uint8Array(await blob.arrayBuffer()))
  return await invoke<boolean>('save_document_as', { contents, suggestedName: filename })
}
