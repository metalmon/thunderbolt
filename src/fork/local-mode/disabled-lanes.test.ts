/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it } from 'bun:test'
import { hasProAccess } from '@/integrations/thunderbolt-pro/utils'
import { computeEffectiveProxyEnabled } from '@/lib/proxy-fetch'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'
import { readRepoFile } from '../testing/source-file'

const setMode = (operationMode: 'server' | 'local') => useLocalSettingsStore.setState({ operationMode })

afterEach(() => {
  setMode(initialLocalSettings.operationMode)
})

describe('local mode disables the lanes that go through our backend', () => {
  // Pro is web search, page fetch and link previews — `/v1/search`,
  // `/v1/pro/fetch-content`, `/v1/preview`. All three exist only on our backend,
  // so in local mode they are not "unavailable", they are absent.
  it('turns Pro off', async () => {
    setMode('local')
    expect(await hasProAccess()).toBe(false)

    setMode('server')
    expect(await hasProAccess()).toBe(true)
  })

  // The decisive half: `hasProAccess` also gates the tool list handed to the
  // MODEL. Hiding Pro in the UI alone would leave the model holding a search
  // tool that can only fail, and it would keep calling it.
  it('gates the model-facing tool set on the same predicate, not just the UI', () => {
    const tools = readRepoFile('src/lib/tools.ts')
    expect(tools.includes('hasProAccess')).toBe(true)
    // The Pro tool configs must sit behind that check rather than being pushed
    // unconditionally.
    const proEnabledGate = /proEnabled[\s\S]{0,400}createProConfigs/.test(tools)
    expect(proEnabledGate).toBe(true)
  })

  // One point covers models (openai/anthropic/openrouter/custom), MCP, remote
  // ACP agents off the loopback, and Gemini Live's relay: they all ask this.
  it('never routes through the cloud proxy, even with the toggle on', () => {
    const tauri = () => true
    const toggleOn = () => 'true'

    setMode('server')
    expect(computeEffectiveProxyEnabled(tauri, toggleOn)).toBe(true)

    setMode('local')
    expect(computeEffectiveProxyEnabled(tauri, toggleOn)).toBe(false)
  })

  // The web branch returns `true` unconditionally (CORS leaves no choice), so it
  // is the one most likely to be overlooked — and there is no proxy to reach in
  // local mode on any platform.
  it('refuses the proxy in local mode on the web too', () => {
    const web = () => false

    setMode('server')
    expect(computeEffectiveProxyEnabled(web, () => null)).toBe(true)

    setMode('local')
    expect(computeEffectiveProxyEnabled(web, () => null)).toBe(false)
  })
})
