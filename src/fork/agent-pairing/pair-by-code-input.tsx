/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLingui } from '@lingui/react/macro'
import { i18n } from '@lingui/core'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { PairByCodeField } from './pair-by-code-field'
import { pairOverAcp, PairingError, type PairOverAcpInputs, type PairResult } from './pair-over-acp'
import { pairingErrorMessages, pairingFailedMessage } from './pairing-messages'

/**
 * Connect-by-code with its own Pair button, for callers where pairing IS the
 * action: the agent detail panel exchanges the code and writes the token to
 * `agents_secrets` on the spot.
 *
 * The add-agent form does NOT use this — it cannot be saved without a passing
 * connection test, so a second button would be redundant; it renders
 * `PairByCodeField` and folds the exchange into that test.
 *
 * `pair` is a test seam (production uses `pairOverAcp`).
 */
export const PairByCodeInput = ({
  url,
  onToken,
  pair = pairOverAcp,
}: {
  url: string
  onToken: (token: string) => void | Promise<void>
  pair?: (inputs: PairOverAcpInputs) => Promise<PairResult>
}) => {
  const { t } = useLingui()
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = code.trim()

  const handlePair = async () => {
    if (trimmed === '') {
      return
    }
    setError(null)
    setPending(true)
    try {
      const { token } = await pair({ url, code: trimmed })
      await onToken(token)
      setCode('')
    } catch (pairError) {
      setError(i18n._(pairError instanceof PairingError ? pairingErrorMessages[pairError.kind] : pairingFailedMessage))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <PairByCodeField value={code} onChange={setCode} invalid={error != null} />
        </div>
        <Button disabled={pending || trimmed === ''} onClick={() => void handlePair()}>
          {t`Pair`}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[length:var(--font-size-sm)] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
