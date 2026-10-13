/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setupTestDatabase, teardownTestDatabase } from '@/dal/test-utils'
import { createTestProvider } from '@/test-utils/test-provider'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { AccountDeleted } from './account-deleted'

describe('AccountDeleted', () => {
  let replaceSpy: ReturnType<typeof spyOn>

  beforeAll(async () => {
    await setupTestDatabase()
    replaceSpy = spyOn(window.location, 'replace').mockImplementation(() => undefined)
  })

  afterAll(async () => {
    replaceSpy.mockRestore()
    await teardownTestDatabase()
  })

  beforeEach(() => {
    replaceSpy.mockClear()
  })

  const renderComponent = () =>
    render(<AccountDeleted />, {
      wrapper: createTestProvider(),
    })

  describe('rendering', () => {
    it('renders heading and description', () => {
      renderComponent()
      expect(screen.getByRole('heading', { name: 'Account Deleted' })).toBeInTheDocument()
      expect(screen.getByText('Your account has been deleted and local data has been cleared.')).toBeInTheDocument()
    })

    // The brand reaches the user through the RU/EN catalogs (msgstr-only swap), so the
    // component's message id stays the upstream name — and `src/testing-library.ts` mocks
    // the Lingui macros to render the English SOURCE. Asserting "Volt" here tested the
    // mock, not the product, and only passed because this branch applies last.
    it('renders the brand heading', () => {
      renderComponent()
      expect(screen.getByText('Thunderbolt')).toBeInTheDocument()
    })

    it('renders Back to App button', () => {
      renderComponent()
      expect(screen.getByRole('button', { name: 'Back to App' })).toBeInTheDocument()
    })
  })

  describe('Back to App button', () => {
    it('calls window.location.replace("/") when clicked', () => {
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Back to App' }))
      expect(replaceSpy).toHaveBeenCalledWith('/')
    })
  })
})
