/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { GradientCircleCheck } from '@/components/ui/gradient-circle-check'
import { OnboardingStepHeader } from './onboarding-step-header'
import { useTranslation } from 'react-i18next'

export const OnboardingCelebrationStep = () => {
  const { t } = useTranslation('onboarding')

  return (
    <div className="flex h-full w-full flex-col justify-center">
      <OnboardingStepHeader icon={<GradientCircleCheck className="size-12" />} title={`${t('celebration.allSet')} 🎉`} />
    </div>
  )
}
