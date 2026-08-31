/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@/testing-library'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { Spinner } from './spinner'

describe('Spinner', () => {
  it('renders an svg that inherits size and color via className, never rotating', () => {
    const { container } = render(<Spinner className="size-4 text-muted-foreground" />)
    const svg = container.querySelector('svg')!
    expect(svg).toBeInTheDocument()
    expect(svg.getAttribute('class')).toContain('volt-spinner')
    expect(svg.getAttribute('class')).toContain('size-4')
    // The mark must not spin — the charge animates internally instead.
    expect(svg.getAttribute('class')).not.toContain('animate-spin')
    // The charge band sweeps via a SMIL <animate> on its `y` (engine-agnostic).
    expect(container.querySelector('.volt-charge-band')).toBeInTheDocument()
    expect(container.querySelector('animate')?.getAttribute('attributeName')).toBe('y')
  })

  it('gives each instance a unique clip id so multiple spinners never collide', () => {
    const { container } = render(
      <>
        <Spinner />
        <Spinner />
      </>,
    )
    const clipIds = [...container.querySelectorAll('clipPath')].map((c) => c.id)
    expect(clipIds).toHaveLength(2)
    expect(clipIds[0]).not.toBe(clipIds[1])
  })

  it('applies the pixel size fallback and forwards arbitrary svg props', () => {
    const { container } = render(<Spinner size={40} data-testid="load" aria-label="Loading" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('40')
    expect(svg.getAttribute('data-testid')).toBe('load')
    // Consumer-provided aria overrides the default aria-hidden.
    expect(svg.getAttribute('aria-label')).toBe('Loading')
  })
})
