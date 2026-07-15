/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Loader2 } from 'lucide-react'
import { type FC } from 'react'
import { useTranslation } from 'react-i18next'

type LoadingProps = {
  className?: string
  size?: number
}

export const Loading: FC<LoadingProps> = ({ className, size = 24 }) => {
  const { t } = useTranslation('common')

  return (
    <div className="flex items-center justify-center w-full h-[100vh]" role="status" aria-label={t('loading')}>
      <Loader2 className={`animate-spin text-gray-500 ${className || ''}`} size={size} />
    </div>
  )
}

export const PageFallback: FC = () => {
  const { t } = useTranslation('common')

  return (
    <div className="flex items-center justify-center h-full w-full" role="status" aria-label={t('loading')}>
      <Loader2 className="animate-spin text-muted-foreground" size={24} />
    </div>
  )
}

export default Loading
