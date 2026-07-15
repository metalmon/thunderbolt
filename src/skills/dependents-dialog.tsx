/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ArrowRight } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { Skill } from '@/types'
import { useTranslation } from 'react-i18next'

export type DependentsAction = 'disable' | 'delete'

export const DependentsDialog = ({
  open,
  onOpenChange,
  action,
  targetName,
  dependents,
  onConfirm,
  onJumpToDependent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: DependentsAction
  targetName: string
  dependents: Skill[]
  onConfirm: () => void
  onJumpToDependent: (id: string) => void
}) => {
  const { t } = useTranslation('settings')
  const actionLabel = t(`skills.${action}`)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('skills.dependentsTitle', { action: actionLabel, name: targetName })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('skills.dependentsDescription', { count: dependents.length, action })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1.5">
          {dependents.map((dep) => (
            <li key={dep.id}>
              <button
                type="button"
                onClick={() => onJumpToDependent(dep.id)}
                className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <span>/{dep.name}</span>
                <ArrowRight size={14} className="text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('skills.cancel')}</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm}>
            {t('skills.dependentsAction', { action: actionLabel })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
