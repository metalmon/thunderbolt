/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { FetchContentResponse } from '@/pro/types'

const DEFAULT_MAX = 16_000
const HARD_CAP = 64_000
const MIN = 1_000
// Firecrawl Simple only validates the Bearer token as a UUID (no key store), so
// any UUID works; override with FIRECRAWL_TOKEN.
const DEFAULT_TOKEN = '00000000-0000-4000-8000-000000000000'

/** Base URL of the self-hosted Firecrawl, or '' when unconfigured (→ Exa fallback). */
export const getFirecrawlUrl = (): string => (process.env.FIRECRAWL_URL ?? '').replace(/\/$/, '')

type FirecrawlScrapeResponse = {
  success?: boolean
  data?: {
    markdown?: string
    metadata?: { title?: string; sourceURL?: string; author?: string }
  }
}

/**
 * Fetch a page's readable markdown via self-hosted Firecrawl `POST /v1/scrape`
 * and map it to the `FetchContentResponse` the `/pro/fetch-content` handler
 * returns (so the frontend `fetch_content` tool is untouched).
 */
export const forkFirecrawlScrape = async (
  url: string,
  maxLength: number | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<FetchContentResponse> => {
  const base = getFirecrawlUrl()
  const token = process.env.FIRECRAWL_TOKEN || DEFAULT_TOKEN
  const maxChars = Math.min(Math.max(maxLength ?? DEFAULT_MAX, MIN), HARD_CAP)

  const res = await fetchFn(`${base}/v1/scrape`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url, formats: ['markdown'], timeout: 60_000, blockMedia: true }),
  })
  if (!res.ok) {
    return { data: null, success: false, error: `Firecrawl scrape failed (${res.status})` }
  }

  const json = (await res.json()) as FirecrawlScrapeResponse
  const markdown = json.data?.markdown ?? ''
  if (!markdown) {
    return { data: null, success: true }
  }

  const isTruncated = markdown.length >= maxChars
  const hint =
    isTruncated && maxChars < HARD_CAP
      ? `\n\n[Content truncated. Call fetch_content with max_length=${Math.min(maxChars * 2, HARD_CAP)} for more.]`
      : ''

  const data = {
    url: json.data?.metadata?.sourceURL ?? url,
    title: json.data?.metadata?.title ?? null,
    text: markdown.slice(0, maxChars) + hint,
    isTruncated,
    favicon: null,
    image: null,
    author: json.data?.metadata?.author ?? null,
    published_date: null,
  }
  // The backend FetchContentData is exa-js's SearchResult shape, but the wire
  // contract the frontend consumes is this subset — cast past the exa type.
  return { data: data as unknown as NonNullable<FetchContentResponse['data']>, success: true }
}
