import { displayName } from '../fork/identity.ts'
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { i18n } from '../fork/i18n.ts'

type StateErrorCode = 'config-invalid' | 'config-version-unsupported'
type StateError = Error & { readonly code: StateErrorCode; readonly message: string }

/** Creates the shared error shape for invalid or newer persisted CLI state. */
export const createStateError = (subject: 'auth config' | 'config', code: StateErrorCode, path: string): StateError => {
  const unsupported = code === 'config-version-unsupported'
  // The subject is part of the sentence, so it is interpolated rather than
  // concatenated: word order differs across languages.
  const subjectName = subject === 'config' ? i18n._({ id: 'config' }) : i18n._({ id: 'auth config' })
  const message = unsupported
    ? i18n._({
        id: '{subject} at {path} was written by a newer {app} CLI version',
        values: { subject: subjectName, path, app: displayName },
      })
    : i18n._({ id: '{subject} at {path} is invalid', values: { subject: subjectName, path } })
  return Object.assign(new Error(message), { code, message })
}
