/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal'
import { Button } from '@/components/ui/button'
import { useSyncSetup } from '@/hooks/use-sync-setup'
import { useApprovalPolling } from '@/hooks/use-approval-polling'
import { checkApprovalAndUnwrap } from '@/services/encryption'
import { cancelPending } from '@/api/encryption'
import { useHttpClient } from '@/contexts'
import { RecoveryKeyDisplayStep } from './recovery-key-display-step'
import { ApprovalWaitingStep } from './approval-waiting-step'
import { RecoveryKeyEntryStep } from './recovery-key-entry-step'
import { IconCircle } from '@/components/onboarding/icon-circle'
import { showRevokedDeviceModalEvent } from '@/hooks/use-credential-events'
import { ArrowLeft, CheckCircle, Loader2, Lock, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

type SyncSetupModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

/**
 * Multi-step wizard for sync/encryption setup.
 *
 * Flow: intro → detecting (auto) → (first-device-setup → recovery-key-display | approval-waiting)
 */
export const SyncSetupModal = ({ open, onOpenChange, onComplete }: SyncSetupModalProps) => {
  const { t } = useTranslation('common')
  const setup = useSyncSetup()
  const httpClient = useHttpClient()
  const hasCompletedRef = useRef(false)

  // Reset wizard state when modal opens (not on close — avoids step flash during close animation)
  const prevOpen = useRef(false)
  if (open && !prevOpen.current) {
    setup.reset()
    hasCompletedRef.current = false
  }
  prevOpen.current = open

  const isRecoveryKeyStep = setup.step === 'recovery-key-display'
  const canDismiss = !isRecoveryKeyStep && !setup.isLoading

  const completeAndClose = () => {
    if (hasCompletedRef.current) {
      return
    }
    hasCompletedRef.current = true
    onComplete()
    onOpenChange(false)
  }

  const showSuccess = () => {
    setup.completeSetup()
  }

  const handleFirstDeviceDone = () => {
    completeAndClose()
  }

  const handleContinueIntro = async () => {
    const result = await setup.continueIntro()
    if (result === 'already-trusted') {
      showSuccess()
    }
  }

  const handleContinueFirstDeviceSetup = async () => {
    await setup.continueFirstDeviceSetup()
  }

  const handleApprovalContinue = async () => {
    const success = await setup.confirmApproval()
    if (success) {
      showSuccess()
    }
  }

  const handleRevoked = () => {
    onOpenChange(false)
    window.dispatchEvent(new CustomEvent(showRevokedDeviceModalEvent))
  }

  const handleDenied = () => {
    setup.deviceDenied()
  }

  const stepsAfterRegistration: readonly string[] = ['detecting', 'approval-waiting', 'recovery-key-entry', 'denied']

  const handleClose = () => {
    // Cancel pending state on server when closing after device was registered
    if (stepsAfterRegistration.includes(setup.step)) {
      cancelPending(httpClient).catch(() => {})
    }
    onOpenChange(false)
  }

  const { isPolling } = useApprovalPolling({
    enabled: setup.step === 'approval-waiting',
    checkApproval: () => checkApprovalAndUnwrap(httpClient),
    onApproved: showSuccess,
    onRevoked: handleRevoked,
    onDenied: handleDenied,
  })

  const handleRecoveryKeySubmit = async () => {
    const success = await setup.submitRecoveryKey()
    if (success) {
      showSuccess()
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && canDismiss) {
          if (setup.step === 'setup-complete') {
            completeAndClose()
          } else {
            handleClose()
          }
        }
      }}
      className="sm:min-h-0 sm:h-auto"
      showCloseButton={canDismiss}
      onInteractOutside={(e) => {
        if (!canDismiss) {
          e.preventDefault()
        }
      }}
      onEscapeKeyDown={(e) => {
        if (!canDismiss) {
          e.preventDefault()
        }
      }}
    >
      {setup.step === 'recovery-key-entry' && (
        <button
          type="button"
          onClick={setup.chooseAdditionalDevice}
          className="absolute left-4 top-4 flex h-[var(--touch-height-sm)] w-[var(--touch-height-sm)] cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-[var(--icon-size-default)]" />
          <span className="sr-only">{t('goBack')}</span>
        </button>
      )}

      <ResponsiveModalContent>
        {setup.step === 'intro' && <IntroStep onContinue={handleContinueIntro} isLoading={setup.isLoading} />}

        {setup.step === 'detecting' && (
          <DetectingStep isLoading={setup.isLoading} error={setup.error} onRetry={handleContinueIntro} />
        )}

        {setup.step === 'first-device-setup' && (
          <FirstDeviceSetupStep
            onContinue={handleContinueFirstDeviceSetup}
            isLoading={setup.isLoading}
            error={setup.error}
          />
        )}

        {setup.step === 'recovery-key-display' && (
          <RecoveryKeyDisplayStep recoveryKey={setup.recoveryKey} onDone={handleFirstDeviceDone} />
        )}

        {setup.step === 'approval-waiting' && (
          <ApprovalWaitingStep
            error={setup.approvalError}
            onContinue={handleApprovalContinue}
            onUseRecoveryKey={setup.goToRecoveryKeyEntry}
            isLoading={setup.isLoading}
            isPolling={isPolling}
          />
        )}

        {setup.step === 'recovery-key-entry' && (
          <RecoveryKeyEntryStep
            value={setup.recoveryKeyInput}
            error={setup.recoveryKeyError}
            onChange={setup.setRecoveryKeyInput}
            onSubmit={handleRecoveryKeySubmit}
            isLoading={setup.isLoading}
          />
        )}

        {setup.step === 'denied' && <DeniedStep onRetry={setup.reset} />}

        {setup.step === 'setup-complete' && <SetupCompleteStep onDone={completeAndClose} />}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

// =============================================================================
// Intro step
// =============================================================================

const IntroStep = ({ onContinue, isLoading }: { onContinue: () => void; isLoading: boolean }) => {
  const { t } = useTranslation('common')

  return (
    <div className="w-full flex flex-col">
      <div className="text-center space-y-4">
        <IconCircle>
          <ShieldCheck className="w-8 h-8 text-primary" />
        </IconCircle>
        <h2 className="text-2xl font-bold">{t('syncSetup.introTitle')}</h2>
        <p className="text-muted-foreground">{t('syncSetup.introDescription')}</p>
      </div>

      <div className="pt-5">
        <Button className="w-full" onClick={onContinue} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('syncSetup.settingUp')}
            </>
          ) : (
            t('continue')
          )}
        </Button>
      </div>
    </div>
  )
}

// =============================================================================
// Detecting step — auto-detects via server, shows spinner or error
// =============================================================================

type DetectingStepProps = {
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

const DetectingStep = ({ isLoading, error, onRetry }: DetectingStepProps) => {
  const { t } = useTranslation('common')

  return (
    <div className="w-full flex flex-col">
      <div className="text-center space-y-4">
        {isLoading && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <h2 className="text-2xl font-bold">{t('syncSetup.detectingTitle')}</h2>
            <p className="text-muted-foreground">{t('syncSetup.detectingDescription')}</p>
          </>
        )}
        {error && (
          <>
            <h2 className="text-2xl font-bold">{t('errorGeneric')}</h2>
            <p className="text-sm text-destructive">{error}</p>
            <div className="pt-2">
              <Button onClick={onRetry}>{t('tryAgain')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// First device setup step — explanation before key generation
// =============================================================================

type FirstDeviceSetupStepProps = {
  onContinue: () => void
  isLoading: boolean
  error: string | null
}

const FirstDeviceSetupStep = ({ onContinue, isLoading, error }: FirstDeviceSetupStepProps) => {
  const { t } = useTranslation('common')

  return (
    <div className="w-full flex flex-col">
      <div className="text-center space-y-4">
        <IconCircle>
          <Lock className="w-8 h-8 text-primary" />
        </IconCircle>
        <h2 className="text-2xl font-bold">{t('syncSetup.firstDeviceTitle')}</h2>
        <p className="text-muted-foreground">{t('syncSetup.firstDeviceDescription')}</p>
        <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{t('syncSetup.firstDeviceWarning')}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="pt-5">
        <Button className="w-full" onClick={onContinue} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('syncSetup.generatingKeys')}
            </>
          ) : (
            t('continue')
          )}
        </Button>
      </div>
    </div>
  )
}

// =============================================================================
// Setup complete step — success confirmation for additional device flows
// =============================================================================

const DeniedStep = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation('common')

  return (
    <div className="w-full flex flex-col">
      <div className="text-center space-y-4">
        <IconCircle>
          <ShieldAlert className="w-8 h-8 text-destructive" />
        </IconCircle>
        <h2 className="text-2xl font-bold">{t('syncSetup.deniedTitle')}</h2>
        <p className="text-muted-foreground">{t('syncSetup.deniedDescription')}</p>
      </div>

      <div className="pt-5">
        <Button className="w-full" onClick={onRetry}>
          {t('tryAgain')}
        </Button>
      </div>
    </div>
  )
}

// =============================================================================
// Setup complete step — success confirmation for additional device flows
// =============================================================================

const SetupCompleteStep = ({ onDone }: { onDone: () => void }) => {
  const { t } = useTranslation('common')

  return (
    <div className="w-full flex flex-col">
      <div className="text-center space-y-4">
        <IconCircle>
          <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
        </IconCircle>
        <h2 className="text-2xl font-bold">{t('syncSetup.completeTitle')}</h2>
        <p className="text-muted-foreground">{t('syncSetup.completeDescription')}</p>
      </div>

      <div className="pt-5">
        <Button className="w-full" onClick={onDone}>
          {t('done')}
        </Button>
      </div>
    </div>
  )
}
