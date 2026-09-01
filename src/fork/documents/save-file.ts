/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isMobile } from '@/lib/platform'

// Minimal shape of the File System Access API's showSaveFilePicker — not yet in
// the TypeScript DOM lib, so we type just what we use.
type SaveFilePicker = (options?: { suggestedName?: string }) => Promise<{
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
}>

const anchorDownload = (blobUrl: string, fileName: string): void => {
  const anchor = document.createElement('a')
  anchor.href = blobUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * Saves a blob-URL to disk, prompting the user for a location where possible.
 *
 * On the desktop WebView (WebView2) and Chromium browsers the File System
 * Access API (`showSaveFilePicker`) opens a native "Save As" dialog. Where that
 * API is unavailable — Firefox/Safari and mobile WebViews, where choosing a
 * folder isn't the norm — it falls back to the universal `<a download>` click,
 * which saves silently to the Downloads folder. Cancelling the picker is a
 * no-op; any other picker failure falls back to the download so the file is
 * still saved.
 */
export const saveBlobUrl = async (blobUrl: string, fileName: string): Promise<void> => {
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (!picker || isMobile()) {
    anchorDownload(blobUrl, fileName)
    return
  }
  try {
    const handle = await picker({ suggestedName: fileName })
    const blob = await fetch(blobUrl).then((res) => res.blob())
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return
    }
    anchorDownload(blobUrl, fileName)
  }
}
