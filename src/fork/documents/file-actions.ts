/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
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
 * Save a stored local file to a location the user picks in the native "Save As"
 * dialog, then open it with the OS default application (Tauri desktop only — the
 * sandboxed web build can neither choose an arbitrary path nor hand a file to a
 * native app). The `save_bytes_to_path` Rust command both writes the bytes
 * (`std::fs`, so the destination isn't fs-scope-limited) AND opens the file (the
 * opener plugin's raw `open_path`, no JS capability in the path).
 *
 * @returns `true` once saved+opened; `false` when unavailable, the user cancelled
 *   the dialog, or the file isn't in blob storage.
 */
export const downloadAndOpenNatively = async (localFileId: string, filename: string): Promise<boolean> => {
  if (!isTauriDesktop()) {
    return false
  }
  const blob = await loadBlob(localFileId)
  if (!blob) {
    return false
  }
  const path = await save({ defaultPath: filename })
  if (!path) {
    return false // user cancelled the dialog
  }
  const contents = Array.from(new Uint8Array(await blob.arrayBuffer()))
  await invoke('save_bytes_to_path', { path, contents })
  return true
}
