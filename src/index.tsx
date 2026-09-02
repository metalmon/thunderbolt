/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import ReactDOM from 'react-dom/client'
import { App } from './app'
import './polyfills'

import './index.css'
import { activateLocale, getActiveLocale } from './i18n'
import { markBundleEvaluated } from './lib/init-timing'
import { initializeLinkInterception } from './lib/intercept-links'
import { isMacDesktop, isMobile as isPlatformMobile, isTauri, isTauriDesktop } from './lib/platform'
import { handlePostUpdateRedirect } from './lib/post-update-redirect'

// The macOS desktop window is transparent with a native blur layer behind it
// (see src-tauri/src/lib.rs). This class makes the body transparent and the
// sidebar translucent so the blur shows through — applied before first render
// to avoid a background flash.
if (isMacDesktop()) {
  document.documentElement.classList.add('mac-vibrancy')
}

// The desktop app always uses the desktop layout, however narrow the window
// (the 600px min window width sits below the 640px/768px breakpoints). The
// class drives the sm/md variant overrides and responsive theme variables in
// index.css; useIsMobile (src/hooks/use-mobile.ts) handles the JS side.
if (isTauriDesktop()) {
  document.documentElement.classList.add('force-desktop')
}

// Native mobile (Tauri iOS/Android) pulls the header cluster up toward the
// notch — see the .native-mobile --header-safe-area-top override in index.css.
if (isTauri() && isPlatformMobile()) {
  document.documentElement.classList.add('native-mobile')
}

// Running here means every static import above (the whole entry bundle) has
// been downloaded, parsed and evaluated — record that phase.
markBundleEvaluated()

// Kick off the locale catalog chunk immediately; rendering doesn't wait for it
// (the source locale is active synchronously with per-message English fallback,
// see src/i18n). Activating the boot-seeded locale rather than the source locale
// keeps the localStorage mirror intact — passing `sourceLocale` here would
// overwrite it with `en` on every load — and starts the right catalog fetch
// before the synced setting hydrates. Once it does, useAppLanguage re-activates
// whatever the setting resolves to; until then this is also what `<html lang>`
// reflects (index.html ships the static `lang="en"` as the pre-boot value).
const bootLocale = getActiveLocale()
document.documentElement.lang = bootLocale
void activateLocale(bootLocale)

// After an update+relaunch, the WebView may restore a stale route (e.g. /waitlist
// verify screen). Detect this and force a clean start at root.
const redirecting = handlePostUpdateRedirect()

if (!redirecting) {
  initializeLinkInterception()

  const root = document.getElementById('root') as HTMLElement

  // Suppress CSS transitions during the first committed paint so a mount doesn't
  // replay every transition at once. Re-enabled after the first paint; user-driven
  // transitions animate normally thereafter.
  const html = document.documentElement
  html.classList.add('no-transitions')
  ReactDOM.createRoot(root).render(<App />)
  requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove('no-transitions')))

  // Freeze the app box while the window is minimized. Minimizing the desktop
  // window shrinks the WebView2 client to ~146×20px, which reflows the entire
  // responsive layout down to that size; restoring reflows it back, and every
  // size-driven element (sidebar width, the framer nav thumb, the composer, the
  // resizable content panel) visibly re-animates the change. The window minWidth
  // is 500, so any viewport below that is the minimize transient — pin #root to
  // its last real size for the duration so the inner layout never sees it and
  // nothing reflows. The pinned size is invisible anyway (the window is minimized)
  // and is released the instant the window returns to a real size. This replaces
  // the per-element animation patches: with no reflow there is nothing to animate.
  const MINIMIZE_VIEWPORT_WIDTH = 400
  let lastNormalWidth = window.innerWidth
  let lastNormalHeight = window.innerHeight
  window.addEventListener('resize', () => {
    if (window.innerWidth < MINIMIZE_VIEWPORT_WIDTH) {
      root.style.width = `${lastNormalWidth}px`
      root.style.height = `${lastNormalHeight}px`
      return
    }
    root.style.width = ''
    root.style.height = ''
    lastNormalWidth = window.innerWidth
    lastNormalHeight = window.innerHeight
  })
}
