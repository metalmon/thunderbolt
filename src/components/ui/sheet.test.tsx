/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'

import { Sheet, SheetContent, SheetTitle } from './sheet'

afterEach(cleanup)

describe('Sheet', () => {
  it('uses a translucent blurred surface', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
        </SheetContent>
      </Sheet>,
    )

    // Solid bg (no backdrop-blur): a blurred surface that slides is janky on weak HW.
    expect(screen.getByText('Sheet title').closest('[data-slot="sheet-content"]')).toHaveClass('bg-background')
  })
})
