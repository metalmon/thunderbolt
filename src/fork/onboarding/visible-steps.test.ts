/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import {
  allOnboardingSteps,
  lastVisibleStep,
  nextVisibleStep,
  prevVisibleStep,
  providerOnboardingStep,
  visibleOnboardingSteps,
  visibleStepPosition,
} from './visible-steps'

const withProviders = visibleOnboardingSteps(true)
const withoutProviders = visibleOnboardingSteps(false)

describe('visibleOnboardingSteps', () => {
  it('shows every step when the deployment can offer an integration', () => {
    expect(withProviders).toEqual([...allOnboardingSteps])
  })

  it('drops only the auth step when it cannot', () => {
    expect(withoutProviders).toEqual([1, 3, 4, 5, 6])
    expect(withoutProviders).not.toContain(providerOnboardingStep)
  })
})

describe('navigation', () => {
  it('steps over the hidden step in both directions', () => {
    expect(nextVisibleStep(withoutProviders, 1)).toBe(3)
    expect(prevVisibleStep(withoutProviders, 3)).toBe(1)
  })

  it('still walks one at a time when nothing is hidden', () => {
    expect(nextVisibleStep(withProviders, 1)).toBe(2)
    expect(prevVisibleStep(withProviders, 3)).toBe(2)
  })

  it('stops at the ends rather than running off', () => {
    expect(nextVisibleStep(withoutProviders, 6)).toBe(6)
    expect(prevVisibleStep(withoutProviders, 1)).toBe(1)
  })

  // Reached by a config that changed mid-wizard, or a restored session.
  it('escapes a step that is no longer visible instead of getting stuck', () => {
    expect(nextVisibleStep(withoutProviders, providerOnboardingStep)).toBe(3)
    expect(prevVisibleStep(withoutProviders, providerOnboardingStep)).toBe(1)
  })
})

describe('progress', () => {
  it('ends on the celebration either way', () => {
    expect(lastVisibleStep(withProviders)).toBe(6)
    expect(lastVisibleStep(withoutProviders)).toBe(6)
  })

  // The dots count visible steps, so five steps show five dots and the third
  // visible step highlights the third dot — not the fourth.
  it('positions the dots against the visible steps', () => {
    expect(withoutProviders).toHaveLength(5)
    expect(visibleStepPosition(withoutProviders, 4)).toBe(3)
    expect(visibleStepPosition(withProviders, 4)).toBe(4)
  })

  it('falls back to the first position for an unknown step', () => {
    expect(visibleStepPosition(withoutProviders, providerOnboardingStep)).toBe(1)
  })
})
