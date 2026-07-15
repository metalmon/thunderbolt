/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ConfirmActionDialog } from '@/components/ui/confirm-action-dialog'
import { useTranslation } from 'react-i18next'

export const DeleteSkillDialog = ({
  open,
  onOpenChange,
  onConfirm,
  skillName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  /** Human display name of the skill being deleted. */
  skillName: string
}) => {
  const { t } = useTranslation('settings')

  return (
    <ConfirmActionDialog
      open={open}
      title={t('skills.deleteTitle', { name: skillName })}
      description={t('skills.deleteDescription')}
      confirmLabel={t('skills.delete')}
      onConfirm={onConfirm}
      onCancel={() => onOpenChange(false)}
    />
  )
}
