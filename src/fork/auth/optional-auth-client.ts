/* Copyright (c) Okta Plus LLC. All rights reserved.
 * Fork-owned file (see AGENTS.md / CLAUDE.md: additive fork surface). */

import { AuthContext, type AuthClient } from '@/contexts/auth-context'
import { useContext } from 'react'

/**
 * The auth client if an `AuthProvider` is mounted, else null.
 *
 * `useAuth` throws without a provider, which is right for code that cannot work
 * without a session. The fork's owner lookup is a *fallback* — it only runs when
 * the agent-owner store is still empty — and upstream deliberately renders some
 * of the hooks it sits in without an `AuthProvider` (see #1390). Reading the
 * context directly keeps those renders working instead of making the fork's
 * fallback a hard dependency on the provider.
 *
 * @returns The mounted auth client, or null when there is no provider.
 */
export const useOptionalAuthClient = (): AuthClient | null => useContext(AuthContext)?.authClient ?? null
