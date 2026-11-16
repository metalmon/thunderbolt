/* Copyright (c) Okta Plus LLC. All rights reserved.
 * Fork-owned file (see AGENTS.md / CLAUDE.md: additive fork surface). */

/**
 * Re-label the native tray menu whenever the active locale changes.
 *
 * Upstream builds the tray once, at step 7 of app initialization, passing the
 * labels it resolves at that moment (`TrayManager.initIfSupported`). On the
 * desktop that is a race the fork loses: WebView2 reports `navigator.languages`
 * as the language the BINARY runs in, so boot resolves `en` and the real locale
 * only lands after `loadSystemLocale()` returns over IPC. Whichever side wins,
 * the menu keeps the labels from that one call — the tray is native and never
 * re-reads them — which is how «Show/Quit» stayed English in a Russian app.
 *
 * Re-initializing is the sanctioned fix rather than a workaround: the Rust side
 * owns the tray across reloads and each initialization refreshes its labels
 * (see the comment on `TrayManager`). Calling it again is therefore idempotent.
 */

import { useEffect } from 'react'
import { useActiveLocale } from '@/i18n/use-active-locale'
import { TrayManager } from '@/lib/tray'

export const useTrayLabels = (): void => {
  const locale = useActiveLocale()
  useEffect(() => {
    void TrayManager.initIfSupported()
  }, [locale])
}
