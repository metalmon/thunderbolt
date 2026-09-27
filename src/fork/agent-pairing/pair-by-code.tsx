/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useQueryClient } from '@tanstack/react-query'

import { useDatabase } from '@/contexts'
import { setAgentBearerToken } from '@/dal'
import { PairByCodeInput } from './pair-by-code-input'
import type { PairOverAcpInputs, PairResult } from './pair-over-acp'

/**
 * Connect-by-code affordance for an EXISTING custom agent's detail panel:
 * exchanges a pairing code for a bearer token and writes it to the SAME
 * `agents_secrets` slot the manual token field uses (re-pairing / token
 * rotation). Renders nothing without a URL to pair against. `pair` is a test
 * seam. The one-shot pairing input itself lives in `PairByCodeInput`, shared
 * with the add-agent form (which routes the token into its own form state).
 */
export const PairByCode = ({
  agentId,
  agentUrl,
  pair,
}: {
  agentId: string
  agentUrl?: string | null
  pair?: (inputs: PairOverAcpInputs) => Promise<PairResult>
}) => {
  const db = useDatabase()
  const queryClient = useQueryClient()

  if (!agentUrl) {
    return null
  }

  return (
    <PairByCodeInput
      url={agentUrl}
      pair={pair}
      onToken={async (token) => {
        await setAgentBearerToken(db, agentId, token)
        await queryClient.invalidateQueries({ queryKey: ['agent-secrets', agentId] })
      }}
    />
  )
}
