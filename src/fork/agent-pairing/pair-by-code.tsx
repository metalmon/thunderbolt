/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLingui } from '@lingui/react/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDatabase } from '@/contexts'
import { setAgentBearerToken } from '@/dal'
import { pairOverAcp, PairingError, type PairOverAcpInputs, type PairResult } from './pair-over-acp'

/**
 * Connect-by-code affordance for a custom agent: the user enters a short pairing
 * code, we exchange it for a bearer token over the ACP socket and write it to
 * the SAME `agents_secrets` slot the manual token field uses — so pairing is
 * just an automated way to fill that slot. Renders nothing without a URL to
 * pair against. The `pair` prop is a test seam (production uses `pairOverAcp`).
 */
export const PairByCode = ({
  agentId,
  agentUrl,
  pair = pairOverAcp,
}: {
  agentId: string
  agentUrl?: string | null
  pair?: (inputs: PairOverAcpInputs) => Promise<PairResult>
}) => {
  const { t } = useLingui()
  const db = useDatabase()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = code.trim()

  if (!agentUrl) {
    return null
  }

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
      const { token } = await pair({ url: agentUrl, code: trimmed })
      await setAgentBearerToken(db, agentId, token)
      setCode('')
      await queryClient.invalidateQueries({ queryKey: ['agent-secrets', agentId] })
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
