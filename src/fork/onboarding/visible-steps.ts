/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Which onboarding steps a deployment actually shows.
 *
 * The wizard's steps are positional (1…6) and the auth step invites the user to
 * connect Google or Microsoft. A closed-perimeter install reaches neither, so the
 * step is an invitation it cannot honour — and the backend already knows, because
 * it is the one holding (or not holding) the OAuth client ids.
 *
 * Steps are filtered rather than renumbered: every step keeps the number its
 * component is keyed on, and only navigation and the progress indicator work off
 * the visible subset. Renumbering would touch every `currentStep === n` site and
 * break the moment another step becomes conditional.
 */

/** The auth step — the only conditional one today. */
export const providerOnboardingStep = 2

/** Every step the wizard can show, in order. The last is the celebration. */
export const allOnboardingSteps = [1, 2, 3, 4, 5, 6] as const

export type OnboardingStepNumber = (typeof allOnboardingSteps)[number]

/**
 * The steps to show, given whether the deployment can offer any OAuth integration.
 *
 * @param hasOAuthProviders - from `selectHasOAuthProviders`
 */
export const visibleOnboardingSteps = (hasOAuthProviders: boolean): OnboardingStepNumber[] =>
  hasOAuthProviders
    ? [...allOnboardingSteps]
    : allOnboardingSteps.filter((step) => step !== providerOnboardingStep)

/**
 * The next visible step after `current`, or `current` when it is already the last.
 *
 * A `current` that is not itself visible (a hidden step reached by a stale link or
 * a config that changed mid-wizard) advances to the first visible step after it
 * rather than getting stuck.
 *
 * @param steps - the visible steps, in order
 * @param current - the step being left
 */
export const nextVisibleStep = (steps: readonly number[], current: number): number =>
  steps.find((step) => step > current) ?? steps[steps.length - 1] ?? current

/**
 * The previous visible step before `current`, or `current` when it is the first.
 *
 * @param steps - the visible steps, in order
 * @param current - the step being left
 */
export const prevVisibleStep = (steps: readonly number[], current: number): number =>
  [...steps].reverse().find((step) => step < current) ?? steps[0] ?? current

/** The step that ends the wizard. */
export const lastVisibleStep = (steps: readonly number[]): number => steps[steps.length - 1] ?? 1

/** Where `current` sits among the visible steps, 1-based — what the progress dots
 *  should highlight once a step can be missing. */
export const visibleStepPosition = (steps: readonly number[], current: number): number => {
  const index = steps.indexOf(current)
  return index === -1 ? 1 : index + 1
}
