/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type OnboardingActionButtonsProps = {
  onBack?: () => void
  onSkip?: () => void
  onContinue: () => void
  showBack?: boolean
  showSkip?: boolean
  showContinue?: boolean
  continueText?: string
  continueDisabled?: boolean
  skipDisabled?: boolean
}

export const OnboardingActionButtons = ({
  onBack,
  onSkip,
  onContinue,
  showBack = true,
  showSkip = true,
  showContinue = true,
  continueText,
  continueDisabled = false,
  skipDisabled = false,
}: OnboardingActionButtonsProps) => {
  const { t } = useTranslation('onboarding')
  const resolvedContinueText = continueText ?? t('actions.continue')

  return (
    <div className="flex flex-1 w-full justify-between">
      <div>
        {showBack && onBack && (
          <Button onClick={onBack} variant="ghost" className="justify-center">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className={`flex space-x-2 ${!showBack && !showSkip && 'w-full'}`}>
        {showSkip && onSkip && (
          <Button onClick={onSkip} variant="ghost" disabled={skipDisabled}>
            {t('actions.skip')}
          </Button>
        )}
        {showContinue && onContinue && (
          <Button onClick={onContinue} disabled={continueDisabled} className={`${!showBack && !showSkip && 'w-full'}`}>
            {resolvedContinueText}
          </Button>
        )}
      </div>
    </div>
  )
}
