/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Build-time override of lucide-react's `Loader2`. vite.config.ts aliases
// `lucide-react` → this shim (and `lucide-react-real` → the real package), so
// every `import { Loader2 } from 'lucide-react'` — upstream or fork, present or
// future — renders the Volt Spinner with no per-file edits. This is why the fork
// no longer hand-replaces Loader2, and why an upstream sync can't reintroduce the
// wrong spinner. Every other icon passes straight through.
//
// `lucide-react-real` is aliased to the package directory, so vite resolves its
// entry from package.json — a lucide upgrade that moves the entry still works. If
// the re-export ever breaks, the vite build fails loudly, not silently in prod.
export * from 'lucide-react-real'
export { Spinner as Loader2 } from './spinner'
