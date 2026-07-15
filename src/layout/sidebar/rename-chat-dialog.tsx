/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { defaultChatTitle } from '@/lib/constants'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type RenameChatDialogProps = {
  open: boolean
  title: string | null
  onOpenChange: (open: boolean) => void
  onRename: (title: string) => void
}

const RenameChatForm = ({ title, onOpenChange, onRename }: Omit<RenameChatDialogProps, 'open'>) => {
  const { t } = useTranslation(['chat', 'common'])
  const [value, setValue] = useState(title ?? defaultChatTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSave = () => {
    const trimmed = value.trim()
    const newTitle = trimmed || defaultChatTitle
    if (newTitle !== (title ?? defaultChatTitle)) {
      onRename(newTitle)
    }
    onOpenChange(false)
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="top-[30%]"
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('sidebar.renameTitle')}</DialogTitle>
      </DialogHeader>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSave()
          }
        }}
        placeholder={t('sidebar.chatNamePlaceholder')}
      />
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button onClick={handleSave}>{t('save', { ns: 'common' })}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

export const RenameChatDialog = ({ open, title, onOpenChange, onRename }: RenameChatDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {open && <RenameChatForm key={title} title={title} onOpenChange={onOpenChange} onRename={onRename} />}
  </Dialog>
)
