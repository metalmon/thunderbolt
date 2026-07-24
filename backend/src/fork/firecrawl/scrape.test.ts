/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { forkFirecrawlScrape, getFirecrawlUrl } from './scrape'

const origUrl = process.env.FIRECRAWL_URL
const origTok = process.env.FIRECRAWL_TOKEN
afterEach(() => {
  process.env.FIRECRAWL_URL = origUrl
  process.env.FIRECRAWL_TOKEN = origTok
})

const scrapeResponse = (markdown: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ success: true, data: { markdown, metadata: { title: 'T', sourceURL: 'https://x/y', ...extra } } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe('forkFirecrawlScrape', () => {
  it('getFirecrawlUrl strips a trailing slash and reads env', () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002/'
    expect(getFirecrawlUrl()).toBe('http://fc:3002')
  })

  it('POSTs /v1/scrape with a Bearer UUID and markdown format, maps to FetchContentData', async () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002'
    process.env.FIRECRAWL_TOKEN = '11111111-1111-4111-8111-111111111111'
    const fetchFn = mock(() => Promise.resolve(scrapeResponse('# Hello world')))
    const res = await forkFirecrawlScrape('https://x/y', 16000, fetchFn as unknown as typeof fetch)
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://fc:3002/v1/scrape')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer 11111111-1111-4111-8111-111111111111')
    expect(JSON.parse(init.body as string).formats).toEqual(['markdown'])
    expect(res.success).toBe(true)
    expect(res.data?.text).toContain('Hello world')
    expect(res.data?.title).toBe('T')
    expect(res.data?.url).toBe('https://x/y')
  })

  it('truncates markdown beyond maxLength and appends the hint', async () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002'
    const big = 'a'.repeat(5000)
    const fetchFn = mock(() => Promise.resolve(scrapeResponse(big)))
    const res = await forkFirecrawlScrape('https://x/y', 1000, fetchFn as unknown as typeof fetch)
    expect(res.data?.isTruncated).toBe(true)
    expect(res.data?.text).toContain('[Content truncated')
    expect(res.data?.text.length).toBeLessThan(5000)
  })

  it('returns {data:null,success:true} for empty markdown', async () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002'
    const fetchFn = mock(() => Promise.resolve(scrapeResponse('')))
    const res = await forkFirecrawlScrape('https://x/y', 16000, fetchFn as unknown as typeof fetch)
    expect(res).toEqual({ data: null, success: true })
  })

  it('returns success:false on a non-OK upstream', async () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002'
    const fetchFn = mock(() => Promise.resolve(new Response('nope', { status: 502 })))
    const res = await forkFirecrawlScrape('https://x/y', 16000, fetchFn as unknown as typeof fetch)
    expect(res.success).toBe(false)
    expect(res.data).toBeNull()
  })
})
