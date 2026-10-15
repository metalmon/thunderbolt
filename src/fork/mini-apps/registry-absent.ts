/* Copyright (c) Okta Plus. All rights reserved. */

import { HttpError } from '@/lib/http'

/**
 * Whether a failed registry request means the backend simply has no mini apps.
 *
 * A backend older than the feature carries no `/v1/mini-apps` route at all and
 * says so with a 404. That is not a failed load: there is nothing broken to
 * report and nothing to retry, because a route does not appear while the tab is
 * open. Read as a failure it costs a stack trace in the console on every mount
 * and a repeated request to a backend that will keep answering the same way —
 * which is exactly what an operator sees first when a current client is pointed
 * at a stand that predates mini apps.
 *
 * Only 404 counts. A 500, a 502 or an unreadable body still mean "we do not
 * know", and the caller must keep telling those apart from an empty registry.
 */
export const isRegistryAbsent = (error: unknown): boolean =>
  error instanceof HttpError && error.response.status === 404
