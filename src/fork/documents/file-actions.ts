/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { writeFile, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
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
    // saveBlobUrl has finished reading the blob (it awaits the write / fires the
    // anchor click synchronously), so the object URL is safe to revoke now.
    URL.revokeObjectURL(url)
  }
}

/** Strip path separators so a filename can't escape the target directory. */
const safeName = (filename: string): string => filename.replace(/[/\\]/g, '_').replace(/^\.+/, '') || 'file'

/** Whether {@link downloadAndOpenNatively} can run on this platform (Tauri desktop only). */
export const canOpenNatively = (): boolean => isTauriDesktop()

/**
 * Write a stored local file into the app's data dir and open it with the OS
 * default application (Tauri desktop only — the sandboxed web build cannot hand a
 * file to a native app). The copy persists under `opened-files/` so the launched
 * app keeps a valid handle. No-op (returns false) when unavailable or the file
 * isn't in blob storage.
 */
export const downloadAndOpenNatively = async (localFileId: string, filename: string): Promise<boolean> => {
  if (!isTauriDesktop()) {
    return false
  }
  const blob = await loadBlob(localFileId)
  if (!blob) {
    return false
  }
  const dir = 'opened-files'
  const relPath = `${dir}/${safeName(filename)}`
  await mkdir(dir, { baseDir: BaseDirectory.AppLocalData, recursive: true })
  await writeFile(relPath, new Uint8Array(await blob.arrayBuffer()), { baseDir: BaseDirectory.AppLocalData })
  await openPath(await join(await appLocalDataDir(), relPath))
  return true
}
