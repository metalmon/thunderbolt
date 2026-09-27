/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLingui } from '@lingui/react/macro'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The pairing-code field on its own — no action button.
 *
 * For callers that already have a button the user must press before the value
 * is worth anything: the add-agent form folds the exchange into its "Test
 * connection" step, since a custom agent cannot be saved without a passing
 * test. The detail panel, where pairing IS the action, uses `PairByCodeInput`
 * instead (this field plus its own button).
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
