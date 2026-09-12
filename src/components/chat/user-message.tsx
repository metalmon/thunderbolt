/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useIsMobile } from '@/hooks/use-mobile'
import { isCanvasOriginTurn, isHiddenCanvasTurn } from '@/fork/zeroclaw/canvas-action-message'
import type { ThunderboltUIMessage } from '@/types'
import { Trans } from '@lingui/react/macro'
import { memo } from 'react'
import { DesktopUserMessage } from './desktop-user-message'
import type { ResendAttachmentHandler } from './message-bubbles'
import { MobileUserMessage } from './mobile-user-message'

type UserMessageProps = {
  message: ThunderboltUIMessage
  /** Set on the latest turn only — re-delivers one attachment as text/images and re-runs. */
  onResendAttachment?: ResendAttachmentHandler
}

export const UserMessage = memo(({ message, onResendAttachment }: UserMessageProps) => {
  const { isMobile } = useIsMobile()

  // Canvas Action Channel: a tool-only canvas turn carries no user-visible
  // ask and must not render as a chat bubble at all (F3b).
  if (isHiddenCanvasTurn(message)) {
    return null
  }

  // A prompt-bearing canvas turn is rendered, but attributed to the canvas
  // rather than presented as the user's own message.
  if (isCanvasOriginTurn(message)) {
    return (
      <div className="flex justify-end px-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 pt-0.5 pb-1 text-xs font-normal text-muted-foreground">
          <Trans>From the canvas</Trans>
        </span>
      </div>
    )
  }

  if (isMobile) {
    return <MobileUserMessage message={message} onResendAttachment={onResendAttachment} />
  }

  return <DesktopUserMessage message={message} onResendAttachment={onResendAttachment} />
})

UserMessage.displayName = 'UserMessage'
