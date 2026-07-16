/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cn } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'

type BackButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Button size variant */
  size?: 'sm' | 'md'
}

const sizeClasses = {
  sm: { button: 'size-6', icon: 'size-3' },
  md: { button: 'size-8', icon: 'size-5' },
} as const

/**
 * Circular back button with arrow icon.
 * Used for navigation in modals, cards, and overlays.
 */
export const BackButton = ({ size = 'md', className, ...props }: BackButtonProps) => {
  const { t } = useTranslation('common')
  const sizes = sizeClasses[size]

  return (
    <button
      type="button"
      aria-label={t('goBack')}
      className={cn(
        'flex cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted',
        sizes.button,
        className,
      )}
      {...props}
    >
      <ArrowLeft className={sizes.icon} />
    </button>
  )
}
