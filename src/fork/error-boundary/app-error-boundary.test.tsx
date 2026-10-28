/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { AppErrorBoundary } from './app-error-boundary'

const Boom = () => {
  throw new Error('render exploded')
}

const originalError = console.error

beforeEach(() => {
  // React logs the caught error itself; silence it so a passing test is quiet.
  console.error = mock(() => {})
})

afterEach(() => {
  console.error = originalError
})

describe('AppErrorBoundary', () => {
  it('renders the error screen instead of an empty page when a child throws', () => {
    const { container } = render(
      <AppErrorBoundary onClearDatabase={() => {}}>
        <p>sibling content</p>
        <Boom />
      </AppErrorBoundary>,
    )

    // The whole point: something is on the page. Without a boundary mounted,
    // React unmounts the entire tree and `container` ends up empty.
    expect(container.firstChild).not.toBeNull()
    // The failed subtree is replaced wholesale, siblings included — asserted
    // rather than assumed, because a boundary that left half a tree standing
    // would be worse than one that replaced all of it.
    expect(screen.queryByText('sibling content')).not.toBeInTheDocument()
    // Anchored on the screen's own affordance rather than its prose, so a copy
    // edit in `AppErrorScreen` doesn't fail this test.
    expect(screen.getByRole('button', { name: /support/i })).toBeInTheDocument()
  })

  it('renders children untouched when nothing throws', () => {
    render(
      <AppErrorBoundary onClearDatabase={() => {}}>
        <p>all good</p>
      </AppErrorBoundary>,
    )

    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  // A boundary that exists but is never mounted protects nothing, and nothing
  // else in the suite would notice its removal — the app renders fine until the
  // day something throws. Checked at the source level because mounting `app.tsx`
  // needs the database, PowerSync and a backend.
  it('is mounted around the app content in app.tsx', () => {
    const app = readFileSync('src/app.tsx', 'utf8')
    // Boolean, not toContain: a failure here would otherwise print all of app.tsx.
    expect(app.includes('AppErrorBoundary')).toBe(true)
  })
})
