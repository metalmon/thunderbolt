/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pairOverAcp, PairingError, type PairOverAcpInputs, type PairResult } from './pair-over-acp'

/**
 * Reusable connect-by-code input: a code field + Pair button that exchanges the
 * code for a bearer token over the ACP socket at `url`, then hands the token to
 * `onToken`. Where the token goes is the caller's choice — the add form fills
 * its token field with it, the agent detail panel writes it to `agents_secrets`.
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

  const messageFor = (kind: PairingError['kind']): string => {
    switch (kind) {
      case 'invalid_code':
        return t`That code didn't work. Check it and try again.`
      case 'transport':
        return t`Couldn't reach the agent. Check the address.`
      case 'timeout':
        return t`Pairing timed out. Try again.`
      case 'rejected':
        return t`Pairing was refused by the agent.`
    }
  }

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
      setError(pairError instanceof PairingError ? messageFor(pairError.kind) : t`Pairing failed. Please try again.`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="agent-pairing-code" className="text-sm font-medium text-muted-foreground">
        {t`Connection code`}
      </label>
      <div className="flex gap-2">
        <Input
          id="agent-pairing-code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t`Enter connection code`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          className="h-9"
        />
        <Button size="sm" disabled={pending || trimmed === ''} onClick={() => void handlePair()}>
          {t`Pair`}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t`Exchanges a one-time code for an access token — no need to paste the token yourself.`}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
