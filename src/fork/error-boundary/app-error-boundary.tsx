/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AppErrorScreen } from '@/components/app-error-screen'
import { createHandleError } from '@/lib/error-utils'
import { trackError } from '@/lib/posthog'

type AppErrorBoundaryProps = {
  children: ReactNode
  /** Same remedy the init-failure path offers, since a corrupt local database is
   *  one of the few things that can crash a render repeatably. */
  onClearDatabase: () => void
}

/**
 * The app's error boundary. There was none at all before this.
 *
 * A throw during render with no boundary mounted unmounts the whole React tree,
 * leaving the page empty — only the background `index.html` paints before React
 * runs survives. That is exactly what a user saw whenever the backend was
 * unreachable: the auth gate threw on a failed sign-in, and the app simply
 * vanished. The gate no longer throws for that case, but the hole it exposed is
 * general — any render-time throw anywhere did the same, and several comments in
 * the codebase referred to "the error boundary" as if one existed.
 *
 * A class is not a style slip: `getDerivedStateFromError` / `componentDidCatch`
 * have no hook equivalent, which is why React still requires one here.
 *
 * Deliberately NOT a retry-in-place: re-rendering the same subtree that just
 * threw usually throws again. The screen offers a reload, which is the action
 * that actually recovers.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console line matters more than the report: this is the one place a
    // render crash becomes visible at all on a user's machine.
    console.error('[app] render crashed:', error, info.componentStack)
    trackError(createHandleError('UNKNOWN_ERROR', 'Render crashed', error), { initialization_step: 'render' })
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }
    return (
      <AppErrorScreen
        error={createHandleError('UNKNOWN_ERROR', error.message || 'Something went wrong', error)}
        onClearDatabase={this.props.onClearDatabase}
      />
    )
  }
}
