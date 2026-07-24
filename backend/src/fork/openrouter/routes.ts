/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Auth } from '@/auth/elysia-plugin'
import { createAuthMacro } from '@/auth/elysia-plugin'
import { safeErrorHandler } from '@/middleware/error-handling'
import { Elysia, type AnyElysia } from 'elysia'

const allowedMethods = new Set(['GET', 'POST', 'OPTIONS'])
const bodylessMethods = new Set(['GET', 'OPTIONS'])
const failoverStatuses = new Set([401, 402, 429])
const COOLDOWN_MS = 60_000
const REFILL_WINDOW_MS = 60_000

const textResponse = (status: number, body: string, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...headers } })

const parseKeys = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export type CreateOpenrouterRoutesOptions = {
  auth: Auth
  fetchFn?: typeof fetch
  rateLimit?: AnyElysia
  /** Override the key pool. Defaults to `OPENROUTER_API_KEYS` (comma-separated). */
  apiKeys?: string[]
  /** Override the upstream base URL. Defaults to `OPENROUTER_BASE_URL` or openrouter.ai. */
  baseUrl?: string
  /** Per-user requests/minute. Defaults to `OPENROUTER_FREE_RPM` or 10. */
  freeRpm?: number
  /** Injectable clock for deterministic tests. */
  now?: () => number
  /** Optional OpenRouter attribution headers. */
  referer?: string
  title?: string
}

/**
 * Free-tier OpenRouter proxy: injects a server-side key (rotating across a pool
 * on rate-limit), throttles per authenticated user, and streams the response.
 * System `openrouter` models point their baseURL at `${cloudUrl}/openrouter`.
 */
export const createOpenrouterRoutes = (options: CreateOpenrouterRoutesOptions) => {
  const { auth, rateLimit } = options
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const now = options.now ?? Date.now
  const keys = options.apiKeys ?? parseKeys(process.env.OPENROUTER_API_KEYS)
  const baseUrl = (options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(
    /\/$/,
    '',
  )
  const freeRpm = options.freeRpm ?? Number(process.env.OPENROUTER_FREE_RPM ?? '10')
  const referer = options.referer ?? process.env.OPENROUTER_REFERER
  const title = options.title ?? process.env.OPENROUTER_TITLE ?? 'Thunderbolt'

  // In-memory state (single backend instance — see spec limitations).
  const cooldownUntil = new Map<string, number>()
  const buckets = new Map<string, { tokens: number; last: number }>()
  let roundRobin = 0

  const availableKeys = (): string[] => {
    const t = now()
    return keys.filter((k) => (cooldownUntil.get(k) ?? 0) <= t)
  }

  const rotate = (arr: string[]): string[] => {
    if (arr.length === 0) return arr
    const start = roundRobin++ % arr.length
    return arr.map((_, i) => arr[(start + i) % arr.length])
  }

  const takeToken = (userId: string): boolean => {
    const cap = Math.max(1, freeRpm)
    const perMs = cap / REFILL_WINDOW_MS
    const t = now()
    const b = buckets.get(userId) ?? { tokens: cap, last: t }
    b.tokens = Math.min(cap, b.tokens + (t - b.last) * perMs)
    b.last = t
    if (b.tokens < 1) {
      buckets.set(userId, b)
      return false
    }
    b.tokens -= 1
    buckets.set(userId, b)
    return true
  }

  const buildHeaders = (request: Request): Headers => {
    const headers = new Headers()
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (lower === 'authorization' || lower === 'host' || lower === 'cookie' || lower === 'connection') return
      headers.set(key, value)
    })
    if (referer) headers.set('HTTP-Referer', referer)
    if (title) headers.set('X-Title', title)
    return headers
  }

  const streamBack = (upstream: Response): Response => {
    const responseHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (lower === 'transfer-encoding' || lower === 'connection') return
      responseHeaders.set(key, value)
    })
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  }

  const proxy = async (request: Request, wildcard: string, userId: string): Promise<Response> => {
    const method = request.method.toUpperCase()
    if (!allowedMethods.has(method)) return textResponse(405, 'Method not allowed')
    if (keys.length === 0) return textResponse(503, 'OpenRouter provider not configured')
    if (!takeToken(userId)) return textResponse(429, 'Rate limit exceeded', { 'Retry-After': '60' })

    const avail = availableKeys()
    if (avail.length === 0) return textResponse(429, 'All keys rate-limited', { 'Retry-After': '60' })

    const subpath = wildcard.startsWith('/') ? wildcard : `/${wildcard}`
    const search = new URL(request.url).search
    const upstreamUrl = `${baseUrl}${subpath}${search}`
    // Buffer the body so it can be re-sent to the next key on failover
    // (request streams are one-shot). Chat bodies are small.
    const body = bodylessMethods.has(method) ? null : await request.arrayBuffer()
    const headers = buildHeaders(request)

    let lastFailover: Response | null = null
    for (const key of rotate(avail)) {
      headers.set('Authorization', `Bearer ${key}`)
      const upstream = await fetchFn(upstreamUrl, {
        method,
        headers,
        body,
        redirect: 'manual',
        decompress: false,
      } as RequestInit & { decompress: boolean })

      if (failoverStatuses.has(upstream.status)) {
        cooldownUntil.set(key, now() + COOLDOWN_MS)
        await upstream.body?.cancel()
        lastFailover = upstream
        continue
      }
      return streamBack(upstream)
    }
    return textResponse(lastFailover?.status ?? 429, 'All keys rate-limited', { 'Retry-After': '60' })
  }

  return new Elysia({ prefix: '/openrouter' })
    .onError(safeErrorHandler)
    .use(createAuthMacro(auth))
    .guard({ auth: true }, (g) => {
      const handler = (ctx: { request: Request; params: Record<string, string | undefined>; user: { id: string } }) =>
        proxy(ctx.request, ctx.params['*'] ?? '', ctx.user.id)
      if (rateLimit) {
        return g.use(rateLimit).all('/*', handler, { parse: 'none' })
      }
      return g.all('/*', handler, { parse: 'none' })
    })
}
