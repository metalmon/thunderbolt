/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { AddToPathButton } from './add-to-path-button'

afterEach(cleanup)

const dir = String.raw`C:\Users\x\AppData\Local\volt\bin`

describe('AddToPathButton', () => {
  // The whole point of the control: the write lands in the user's registry and
  // outlives the app, so a single click must not perform it.
  it('writes nothing until the user confirms', () => {
    const addToPath = mock(async () => ({ alreadyPresent: false, dir }))
    render(<AddToPathButton directory={dir} addToPath={addToPath} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add to PATH' }))

    expect(addToPath).not.toHaveBeenCalled()
    // The directory is named in the confirmation, not left to the user's guess.
    expect(screen.getByText(new RegExp(dir.replaceAll('\\', '\\\\')))).toBeInTheDocument()
  })

  it('cancelling leaves the PATH alone', () => {
    const addToPath = mock(async () => ({ alreadyPresent: false, dir }))
    render(<AddToPathButton directory={dir} addToPath={addToPath} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add to PATH' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(addToPath).not.toHaveBeenCalled()
  })

  it('reports an existing entry as unchanged rather than as a change', async () => {
    const addToPath = mock(async () => ({ alreadyPresent: true, dir }))
    render(<AddToPathButton directory={dir} addToPath={addToPath} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add to PATH' }))
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add to PATH' }).at(-1)!)
    })

    expect(addToPath).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Already on your PATH.')).toBeInTheDocument()
  })
})
