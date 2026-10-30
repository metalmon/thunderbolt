/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useAuth, useHttpClient } from '@/contexts'
import { authRequestHeaders } from '@/contexts/auth-context'
import { isAltchaCaptchaEnabled, isAnonymousAuthEnabled, isSsoMode, isWaitlistBypassed } from '@/lib/auth-mode'
import { useIsLocalMode } from '@/fork/local-mode/mode'
import { HttpError } from '@/lib/http'
import { captchaTokenHeader, captchaVerificationFailedCode } from '@shared/captcha'
import { AltchaTransientError, solveAltchaChallenge } from './altcha'
import { useConfigStore } from '@/api/config-store'

export type AuthRequirement = 'authenticated' | 'unauthenticated'

export type AuthGateState =
  | { status: 'loading' }
  | { status: 'allowed' }
  | { status: 'redirect'; to: string }
  | { status: 'verifying' }
  | { status: 'verification-failed'; retry: () => void }
  /** Fork: the backend could not be reached at all, so no sign-in can succeed. */
  | { status: 'offline'; retry: () => void }

/** Progress of the ALTCHA solve that precedes anonymous sign-in; stays `idle` without a captcha. */
type CaptchaStatus = 'idle' | 'verifying' | 'failed'

/**
 * Hook that determines route access based on authentication state.
 *
 * For `require="authenticated"`:
 *  - has session (real or anonymous) → allowed
 *  - SSO mode + no session → redirect to /sso-redirect, or to /sso-error when `search` carries an SSO `error`
 *  - waitlist bypassed + anonymous overlay enabled + no session → fire `signIn.anonymous()` and show loading
 *    (with `VITE_CAPTCHA_PROVIDER=altcha`, solve a challenge first and show `verifying`, or
 *    `verification-failed` with a retry when the challenge fetch fails or the API refuses the solution)
 *  - waitlist active + no session → redirect to /waitlist
 *  - sign-in could not reach the server → `offline` with a retry (fork; see `signInAnonymously`)
 *  - local mode → allowed, with no session and no sign-in attempt (fork; see `@/fork/local-mode/mode`)
 *
 * For `require="unauthenticated"`:
 *  - has session → redirect to /
 *  - no session → allowed
 *
 * Anonymous users count as "authenticated" for routing — their session has a real
 * `user` record with `isAnonymous: true`. Capability gating per route lives in the
 * route itself, not here.
 *
 * @param search the current location's query string, such as `?error=access_denied`
 */
export const useAuthGate = (require: AuthRequirement, search = ''): AuthGateState => {
  const authClient = useAuth()
  const httpClient = useHttpClient()
  const { data: session, isPending } = authClient.useSession()
  const isAuthenticated = !!session?.user

  // Fork: `!localMode` is the FIRST of the two points local mode needs. This
  // one gates the effect below, which fires before any `return` — so the early
  // exit further down cannot stop it, and without this an autonomous install
  // would still be firing a sign-in at a backend it does not have.
  const localMode = useIsLocalMode()
  // Fork: subscribed, not read once — the fetch resolves after the first render,
  // and the gate must re-decide when it does.
  const configReachable = useConfigStore((state) => state.configReachable)
  const configLoaded = useConfigStore((state) => state.configLoaded)
  const isAnonymousAllowed = isAnonymousAuthEnabled() && !isSsoMode() && isWaitlistBypassed() && !localMode

  const triedAnonRef = useRef(false)
  // The captcha attempt in flight, if any. A ref because a double click on retry lands before the
  // re-render that hides the button; aborted on unmount so a stale attempt never signs in.
  const attemptRef = useRef<AbortController | null>(null)
  const [anonError, setAnonError] = useState<Error | null>(null)
  // Fork: set when sign-in could not reach the server at all. Separate from
  // `anonError` because the two deserve opposite treatment — see `signInAnonymously`.
  const [unreachable, setUnreachable] = useState(false)
  const [captchaStatus, setCaptchaStatus] = useState<CaptchaStatus>('idle')
  if (anonError) {
    throw anonError
  }

  /**
   * Solve a fresh challenge and sign in with it. A transient failure of the challenge step
   * (network, fetch timeout, 5xx, worker failure, solve timeout) or a 403 refusing the solution
   * offers a retry; anything else, such as a 4xx on the challenge, throws during render like any
   * failed anonymous sign-in. Only the challenge step's transient failures are retried: a failed
   * sign-in request (network failure or 5xx) throws, as it did before the captcha.
   */
  const solveAndSignIn = async (signal: AbortSignal) => {
    setCaptchaStatus('verifying')
    const token = await solveAltchaChallenge(httpClient, signal).catch((err: unknown) => {
      if (signal.aborted) {
        return null
      }
      if (!(err instanceof AltchaTransientError)) {
        throw err
      }
      console.error('ALTCHA challenge failed:', err)
      return null
    })
    // Cancelled by unmount: the gate is gone, so neither sign in nor touch its state. The solve
    // rejects on abort; this also catches one that resolved just before the abort landed.
    if (signal.aborted) {
      return null
    }
    if (!token) {
      setCaptchaStatus('failed')
      return null
    }
    const result = await authClient.signIn.anonymous({
      fetchOptions: { headers: authRequestHeaders({ [captchaTokenHeader]: token }), signal },
    })
    if (result?.error?.code === captchaVerificationFailedCode) {
      setCaptchaStatus('failed')
      return null
    }
    return result
  }

  /** One captcha attempt at a time; a call while one is in flight is a no-op. */
  const signInWithCaptcha = async () => {
    if (attemptRef.current) {
      return null
    }
    const attempt = new AbortController()
    attemptRef.current = attempt
    try {
      return await solveAndSignIn(attempt.signal)
    } finally {
      if (attemptRef.current === attempt) {
        attemptRef.current = null
      }
    }
  }

  const signInAnonymously = async () => {
    try {
      setUnreachable(false)
      const result = isAltchaCaptchaEnabled() ? await signInWithCaptcha() : await authClient.signIn.anonymous()
      if (result?.error) {
        // The server answered and refused. A real error: surface it.
        setAnonError(new Error(result.error.message ?? 'Anonymous sign-in failed'))
      }
    } catch (err) {
      // Fork: split on whether the server ANSWERED. An `HttpError` carries a
      // response, so it was reached and refused — that is a real error and keeps
      // reaching the boundary, which is what the captcha path deliberately
      // re-throws a 404/429 for (`altcha.ts:56`). Everything else is a network
      // error or abort: Better Auth resolves HTTP failures with `{ error }` and
      // rejects only when the request never completed. That case used to blank
      // the app whenever the backend was down, since nothing in the tree catches
      // a throw; report it as a state the UI can offer a retry on instead.
      if (err instanceof HttpError) {
        setAnonError(err)
        return
      }
      setUnreachable(true)
    }
  }

  const fireAnonSignIn = useEffectEvent(() => void signInAnonymously())

  // Strict Mode invokes effects twice on mount; the ref dedups so we never fire
  // signIn.anonymous() more than once per gate mount. Only the captcha retry
  // button signs in again.
  //
  // Better Auth client methods resolve with `{ data, error }` for HTTP failures
  // (4xx/5xx) — they do NOT throw. Only network errors / aborts reject. Both
  // paths must be handled or an HTTP error leaves the gate stuck in `loading`
  // forever (the ref prevents a retry): an answer that refuses goes to the error
  // boundary, a request that never completed becomes `offline`.
  useEffect(() => {
    const shouldFireAnon =
      !isPending && !isAuthenticated && require === 'authenticated' && isAnonymousAllowed && !triedAnonRef.current
    if (!shouldFireAnon) {
      return
    }
    triedAnonRef.current = true
    fireAnonSignIn()
  }, [isPending, isAuthenticated, require, isAnonymousAllowed])

  // Unmount cancels a captcha attempt before it can sign in. It also re-arms the auto sign-in,
  // because Strict Mode's simulated unmount keeps the refs and would otherwise leave nothing running.
  useEffect(
    () => () => {
      if (!attemptRef.current) {
        return
      }
      attemptRef.current.abort()
      attemptRef.current = null
      triedAnonRef.current = false
    },
    [],
  )

  // Fork: the second of local mode's two points, and it sits before the pending
  // check on purpose. There is no account in local mode, so the session fetch is
  // irrelevant — and with no backend it settles only when the request gives up,
  // which would be a blank screen for as long as that takes.
  if (localMode) {
    return { status: 'allowed' }
  }

  if (isPending) {
    return { status: 'loading' }
  }

  if (require === 'unauthenticated') {
    return isAuthenticated ? { status: 'redirect', to: '/' } : { status: 'allowed' }
  }

  if (isAuthenticated) {
    return { status: 'allowed' }
  }

  // Fork: ⚠⚠ WAIT for `/config` to answer before choosing an auth path.
  //
  // WHICH path applies — SSO, anonymous, waitlist — is read from the config,
  // and until the fetch lands that read comes from LAST SESSION'S CACHE. An
  // install whose server is gone still has a cache saying "this is an SSO
  // deployment", so the gate redirected to the identity provider on the first
  // render, seconds before the fetch could fail and say otherwise. The
  // reachability check below never got a chance to run.
  //
  // `configLoaded` flips on BOTH success and failure (`fetchConfig` sets it in
  // its catch), and the request is bounded by a 5s timeout, so this waits for a
  // bounded time and never stalls. Local mode returns `allowed` above and never
  // reaches here, which is why skipping the fetch there is safe.
  if (!configLoaded) {
    return { status: 'loading' }
  }

  // Fork: BEFORE any sign-in path, not inside one.
  //
  // ⚠ This used to live only in the anonymous branch, and SSO is its mutex — so
  // an SSO deployment whose server was gone sent the user straight to the IdP
  // behind it and offered nothing else. The only way out of that screen was to
  // reach Settings, which is on the other side of the gate. A pilot machine
  // with a cached `auth.mode` and no server was unusable, with no visible
  // reason: the cached config still says "this is an SSO deployment".
  if (!configReachable) {
    return { status: 'offline', retry: () => void signInAnonymously() }
  }

  if (isAnonymousAllowed) {
    // Checked before the captcha states: an unreachable server explains them all,
    // and "verify you are human" is the wrong thing to show when nothing answered.
    if (unreachable) {
      return { status: 'offline', retry: () => void signInAnonymously() }
    }
    if (captchaStatus === 'failed') {
      return { status: 'verification-failed', retry: () => void signInAnonymously() }
    }
    return captchaStatus === 'verifying' ? { status: 'verifying' } : { status: 'loading' }
  }

  if (isSsoMode()) {
    // Better Auth sends some SSO failures (a SAML account that cannot be linked) to the callback URL, `/`, not to
    // `errorCallbackURL`. Restarting the login from here would loop, as the IdP still holds a session.
    const failedSsoLogin = new URLSearchParams(search).has('error')
    return { status: 'redirect', to: failedSsoLogin ? `/sso-error${search}` : '/sso-redirect' }
  }

  return { status: 'redirect', to: '/waitlist' }
}
