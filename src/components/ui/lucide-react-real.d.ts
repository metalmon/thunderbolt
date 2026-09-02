/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// `lucide-react-real` is a build-time vite alias to the real lucide-react package
// (see vite.config.ts + lucide-shim.ts). Give TypeScript its types by pointing it
// at the real package's declarations.
declare module 'lucide-react-real' {
  export * from 'lucide-react'
}
