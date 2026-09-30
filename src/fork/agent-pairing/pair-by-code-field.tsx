/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLingui } from '@lingui/react/macro'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The pairing-code field on its own — no action button.
 *
 * Pairing happens once, when an agent is added: the add-agent form folds the
 * exchange into its "Test connection" step, since a custom agent cannot be
 * saved without a passing test, so the field needs no button of its own. The
 * detail panel of a saved agent offers the manual token field only — there is
 * no re-pair-by-code, and a revoked or rotated token is recovered by removing
 * and re-adding the agent.
 */
export const PairByCodeField = ({
  value,
  onChange,
  invalid,
}: {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}) => {
  const { t } = useLingui()

  return (
    <div className="grid grid-cols-1 gap-2">
      <Label htmlFor="agent-pairing-code">{t`Connection code`}</Label>
      <Input
        id="agent-pairing-code"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t`Enter connection code`}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={invalid ? true : undefined}
      />
      <p className="text-[length:var(--font-size-xs)] text-muted-foreground">
        {t`Exchanged for an access token when you test the connection — no need to paste the token yourself.`}
      </p>
    </div>
  )
}
