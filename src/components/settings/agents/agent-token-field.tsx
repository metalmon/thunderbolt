/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toCompilableQuery } from '@powersync/drizzle-driver'
import { useQuery } from '@powersync/tanstack-react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDatabase } from '@/contexts'
import { getAgentSecretsQuery, setAgentBearerToken } from '@/dal'

/**
 * Write-only bearer-token field for a custom agent's detail panel: shows
 * whether a token is set (never its value), lets the user paste a new one or
 * clear the stored one. Reactively reads the local-only secrets table so the
 * populated/empty indicator stays live across saves from this device.
 */
export const AgentTokenField = ({ agentId }: { agentId: string }) => {
  const { t } = useTranslation('settings')
  const db = useDatabase()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const secretsQueryKey = ['agent-secrets', agentId]
  const { data: secretRows = [] } = useQuery({
    queryKey: secretsQueryKey,
    query: toCompilableQuery(getAgentSecretsQuery(db, agentId)),
  })
  const secret = secretRows[0]
  const populated = secret?.apiKey != null && secret.authMethod === 'bearer'

  const trimmed = draft.trim()

  const handleSave = async () => {
    if (trimmed === '') {
      return
    }
    setError(null)
    setPending(true)
    try {
      await setAgentBearerToken(db, agentId, trimmed)
      setDraft('')
      // The write is to a local-only table PowerSync's mock doesn't auto-notify
      // (and real cross-device notification would only race the UI); refresh
      // this field's own read explicitly so Save flips the indicator in place.
      await queryClient.invalidateQueries({ queryKey: secretsQueryKey })
    } catch (saveError) {
      console.error('Failed to save agent token', saveError)
      setError(t('editableField.saveError', { field: t('agents.authToken').toLowerCase() }))
    } finally {
      setPending(false)
    }
  }

  const handleClear = async () => {
    setError(null)
    setPending(true)
    try {
      await setAgentBearerToken(db, agentId, null)
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: secretsQueryKey })
    } catch (clearError) {
      console.error('Failed to clear agent token', clearError)
      setError(t('editableField.saveError', { field: t('agents.authToken').toLowerCase() }))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="agent-detail-token" className="text-sm font-medium text-muted-foreground">
        {t('agents.authToken')}
      </label>
      <Input
        id="agent-detail-token"
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={populated ? t('agents.authTokenSet') : t('agents.authTokenPlaceholder')}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        className="h-9"
      />
      <p className="text-sm text-muted-foreground">{t('agents.authTokenHelper')}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {(trimmed !== '' || populated) && (
        <div className="flex justify-end gap-2">
          {populated && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => void handleClear()}>
              {t('agents.authTokenClear')}
            </Button>
          )}
          {trimmed !== '' && (
            <Button size="sm" disabled={pending} onClick={() => void handleSave()}>
              {t('editableField.save')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
