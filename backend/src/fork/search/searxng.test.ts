/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { forkSearxngSearch, getSearxngUrl } from './searxng'

const orig = process.env.SEARXNG_URL
afterEach(() => {
  process.env.SEARXNG_URL = orig
})

const jsonResults = (results: unknown[]) =>
  new Response(JSON.stringify({ results }), { status: 200, headers: { 'content-type': 'application/json' } })

describe('forkSearxngSearch', () => {
  it('getSearxngUrl strips a trailing slash and reads env', () => {
    process.env.SEARXNG_URL = 'http://searxng:8080/'
    expect(getSearxngUrl()).toBe('http://searxng:8080')
  })

  it('queries /search?format=json and maps results to SearchResultDto', async () => {
    process.env.SEARXNG_URL = 'http://searxng:8080'
    const fetchFn = mock(() =>
      Promise.resolve(jsonResults([{ url: 'https://a.com/p', title: 'A', img_src: 'https://a.com/i.png' }])),
    )
    const out = await forkSearxngSearch('cats', 10, fetchFn as unknown as typeof fetch)
    const [url] = fetchFn.mock.calls[0] as [string]
    expect(url).toContain('http://searxng:8080/search?q=cats')
    expect(url).toContain('format=json')
    expect(out[0]).toEqual({
      title: 'A',
      pageUrl: 'https://a.com/p',
      faviconUrl: expect.any(String),
      previewImageUrl: 'https://a.com/i.png',
    })
  })

  it('clamps to the limit and skips results with no valid url', async () => {
    process.env.SEARXNG_URL = 'http://searxng:8080'
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResults([
          { title: 'no-url' }, // no url → skipped (ensureHttps → null)
          { url: 'https://a.com', title: 'a' },
          { url: 'https://b.com', title: 'b' },
          { url: 'https://c.com', title: 'c' },
        ]),
      ),
    )
    const out = await forkSearxngSearch('x', 2, fetchFn as unknown as typeof fetch)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.pageUrl)).toEqual(['https://a.com/', 'https://b.com/'])
  })

  it('returns [] on a non-OK upstream', async () => {
    process.env.SEARXNG_URL = 'http://searxng:8080'
    const fetchFn = mock(() => Promise.resolve(new Response('err', { status: 500 })))
    expect(await forkSearxngSearch('x', 10, fetchFn as unknown as typeof fetch)).toEqual([])
  })
})
