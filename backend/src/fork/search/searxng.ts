/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { SearchResultDto } from '@/api/search'
import { ensureHttps } from '@/utils/url-validation'
import { deriveFaviconUrl } from '@shared/url'

/** Base URL of the self-hosted SearXNG, or '' when unconfigured (→ Exa fallback). */
export const getSearxngUrl = (): string => (process.env.SEARXNG_URL ?? '').replace(/\/$/, '')

type SearxngResult = { url?: string; title?: string; img_src?: string }
type SearxngResponse = { results?: SearxngResult[] }

/**
 * Run a web search via self-hosted SearXNG's JSON API and map results to the
 * `SearchResultDto[]` the `/search` handler returns (frontend `search` tool
 * untouched). https-only, favicon derived from the result host.
 *
 * `import type { SearchResultDto }` is erased at compile time, so `search.ts`
 * importing this module's values creates no runtime cycle.
 */
export const forkSearxngSearch = async (
  q: string,
  limit: number | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<SearchResultDto[]> => {
  const base = getSearxngUrl()
  const n = limit ? Math.min(Math.max(limit, 1), 25) : 10
  const url = `${base}/search?q=${encodeURIComponent(q)}&format=json&safesearch=1`

  const res = await fetchFn(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    return []
  }
  const json = (await res.json()) as SearxngResponse

  const out: SearchResultDto[] = []
  for (const r of json.results ?? []) {
    if (out.length >= n) {
      break
    }
    const pageUrl = ensureHttps(r.url ?? null)
    if (!pageUrl) {
      continue
    }
    out.push({
      title: r.title ?? new URL(pageUrl).hostname,
      pageUrl,
      faviconUrl: deriveFaviconUrl(pageUrl),
      previewImageUrl: ensureHttps(r.img_src ?? null),
    })
  }
  return out
}
