/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import type { PairingErrorKind } from './pair-over-acp'

/**
 * User-facing copy for a failed pairing exchange, shared by the add-agent form
 * (which folds pairing into its connection test) and the detail panel's
 * standalone pair action.
 *
 * Descriptors, not resolved strings: this is module scope, so `t` would pin the
 * boot locale. Resolve at the point of use with `i18n._(pairingErrorMessages[kind])`.
 */
export const pairingErrorMessages: Record<PairingErrorKind, MessageDescriptor> = {
  invalid_code: msg`That code didn't work. Check it and try again.`,
  transport: msg`Couldn't reach the agent. Check the address.`,
  timeout: msg`Pairing timed out. Try again.`,
  rejected: msg`Pairing was refused by the agent.`,
}

/** Fallback for a non-`PairingError` rejection (a bug, not a protocol answer). */
export const pairingFailedMessage: MessageDescriptor = msg`Pairing failed. Please try again.`
