/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { deriveArtifactTitle, extractUiResource, isUiResourceOutput, uiResourceArtifactId } from './ui-resource'
import { deliveredLocalFileId } from './outbound-resource-blob'

const wrap = (resource: unknown) => [{ type: 'content', content: resource }]

describe('extractUiResource', () => {
  it('finds a ui:// text/html resource', () => {
    const ref = extractUiResource(
      wrap({ type: 'resource', resource: { uri: 'ui://pnl/dashboard', mimeType: 'text/html', text: '<h1>Hi</h1>' } }),
    )
    expect(ref).toEqual({ uri: 'ui://pnl/dashboard', mimeType: 'text/html', html: '<h1>Hi</h1>' })
  })

  it('ignores a blob resource (deliver_file) and non-ui uris', () => {
    expect(
      extractUiResource(wrap({ type: 'resource', resource: { uri: 'ui://x', mimeType: 'text/html', blob: 'AAAA' } })),
    ).toBeNull()
    expect(
      extractUiResource(
        wrap({ type: 'resource', resource: { uri: 'attachment://deliver/a.pdf', mimeType: 'text/html', text: 'x' } }),
      ),
    ).toBeNull()
  })

  it('walks past non-resource items', () => {
    const ref = extractUiResource([
      { type: 'text', text: 'ignore' },
      { type: 'resource', resource: { uri: 'ui://x', mimeType: 'text/html', text: 'found' } },
    ])
    expect(ref).toEqual({ uri: 'ui://x', mimeType: 'text/html', html: 'found' })
  })
})

describe('isUiResourceOutput', () => {
  it('recognizes a valid UiResourceOutput', () => {
    const output = {
      uiResource: { uri: 'ui://a', mimeType: 'text/html', html: '<div>Hi</div>' },
    }
    expect(isUiResourceOutput(output)).toBe(true)
  })

  it('rejects malformed output', () => {
    expect(isUiResourceOutput({ html: '<div>Hi</div>' })).toBe(false)
    expect(isUiResourceOutput({ uiResource: null })).toBe(false)
    expect(isUiResourceOutput('not an object')).toBe(false)
  })
})

describe('uiResourceArtifactId', () => {
  it('delegates to deliveredLocalFileId', () => {
    const uri = 'ui://pnl/dashboard'
    expect(uiResourceArtifactId(uri)).toBe(deliveredLocalFileId(uri))
  })
})

describe('deriveArtifactTitle', () => {
  it('prefers <title>', () => {
    expect(deriveArtifactTitle('<title>Dashboard</title><h1>h1</h1>', 'ui://a')).toBe('Dashboard')
  })

  it('falls back to <h1>', () => {
    expect(deriveArtifactTitle('<h1>Settings</h1>', 'ui://a')).toBe('Settings')
  })

  it('fallback to prettified uri', () => {
    expect(deriveArtifactTitle('<div>no title</div>', 'ui://pnl/dashboard')).toBe('Dashboard')
  })

  it('strips control chars and caps length', () => {
    const long = 'A'.repeat(200)
    expect(deriveArtifactTitle(`<title>${long}</title>`, 'ui://a').length).toBeLessThanOrEqual(80)
    expect(deriveArtifactTitle('<title>a b\tc</title>', 'ui://a')).toBe('a b c')
    expect(deriveArtifactTitle('<title>Sales Dashboard</title>', 'ui://a')).toBe('Sales Dashboard')
    const controlCharTitle = '<title>Bad' + String.fromCharCode(1) + 'Title</title>'
    expect(deriveArtifactTitle(controlCharTitle, 'ui://a')).toBe('BadTitle')
  })
})
