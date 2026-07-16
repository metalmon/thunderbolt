/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isFramelessControlsPlatform } from '@/lib/platform'
import { Maximize2, Minus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Custom min/maximize/close buttons for Windows and Linux, where the main
 * window is frameless (`decorations: false`) and there's no native chrome to
 * fall back on. Renders `null` on macOS (Overlay title bar keeps the native
 * traffic lights) and on non-Tauri surfaces.
 *
 * Close mirrors the tray-driven hide-instead-of-quit behavior in `tray.tsx` —
 * dispatching the same `close-requested` event so the tray teardown path stays
 * authoritative rather than duplicating the hide+dock logic here.
 */
export const WindowControls = () => {
  const { t } = useTranslation('common')

  if (!isFramelessControlsPlatform()) {
    return null
  }

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().minimize()
  }

  const handleMaximize = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().toggleMaximize()
  }

  const handleClose = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    // Fire close instead of hide/exit directly — the tray's onCloseRequested
    // handler intercepts, hides the window, and updates the taskbar/dock state.
    await getCurrentWindow().close()
  }

  return (
    <div
      data-tauri-drag-region="false"
      className="flex items-center h-full -mr-2 shrink-0"
      aria-label={t('windowControls.ariaLabel')}
    >
      <button
        type="button"
        onClick={handleMinimize}
        aria-label={t('windowControls.minimize')}
        className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={handleMaximize}
        aria-label={t('windowControls.maximize')}
        className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
      >
        <Maximize2 className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={handleClose}
        aria-label={t('close')}
        className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white cursor-pointer"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
