/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import i18n from '@/i18n/i18n'

type OtpError = { code?: string; message?: string }
type OtpErrorContext = 'link' | 'code'

const messageKeys: Record<OtpErrorContext, Record<string, string>> = {
  link: {
    OTP_EXPIRED: 'otpErrors.link.OTP_EXPIRED',
    INVALID_OTP: 'otpErrors.link.INVALID_OTP',
    TOO_MANY_ATTEMPTS: 'otpErrors.link.TOO_MANY_ATTEMPTS',
  },
  code: {
    OTP_EXPIRED: 'otpErrors.code.OTP_EXPIRED',
    INVALID_OTP: 'otpErrors.code.INVALID_OTP',
    TOO_MANY_ATTEMPTS: 'otpErrors.code.TOO_MANY_ATTEMPTS',
  },
}

/**
 * Returns a user-friendly message for OTP verification errors.
 * Handles OTP_EXPIRED, INVALID_OTP, and TOO_MANY_ATTEMPTS from Better Auth.
 */
export const getOtpErrorMessage = (error: OtpError, context: OtpErrorContext): string => {
  const key = error?.code ? messageKeys[context][error.code] : undefined
  if (key) {
    return i18n.t(key, { ns: 'auth' })
  }
  return error?.message ?? i18n.t('otpErrors.fallback', { ns: 'auth' })
}
