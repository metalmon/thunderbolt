/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `say` has no visual presentation — speaking happens in `executor.ts`, not
 * here. This component exists only so the widget registry's generic
 * `Component` lookup (`widget-renderer.tsx`) has something to render, and it
 * renders nothing so a `say` tag never appears as visible chat content.
 */
export const SayWidget = () => null
