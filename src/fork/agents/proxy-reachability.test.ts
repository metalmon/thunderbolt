/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { isLoopbackBeyondProxy } from './proxy-reachability'

describe('isLoopbackBeyondProxy', () => {
  const proxied = false
  const direct = true

  it('flags loopback addresses when the socket is made by the server', () => {
    for (const url of [
      'wss://127.0.0.1:8453/acp',
      'ws://localhost:42617',
      'wss://[::1]:8453/acp',
      'ws://0.0.0.0:8080',
      'WSS://LOCALHOST:8453/acp',
    ]) {
      expect(isLoopbackBeyondProxy(url, proxied)).toBe(true)
    }
  })

  it('says nothing when the app dials the agent itself', () => {
    expect(isLoopbackBeyondProxy('wss://127.0.0.1:8453/acp', direct)).toBe(false)
  })

  it('leaves routable addresses alone', () => {
    expect(isLoopbackBeyondProxy('wss://agents.example.com/acp', proxied)).toBe(false)
    expect(isLoopbackBeyondProxy('wss://192.168.1.10:8453/acp', proxied)).toBe(false)
  })

  it('stays out of the way of an address that is not a URL yet', () => {
    // Half-typed input and iroh tickets both land here; URL validation owns
    // that verdict, and a second opinion would only add noise.
    expect(isLoopbackBeyondProxy('', proxied)).toBe(false)
    expect(isLoopbackBeyondProxy('wss://', proxied)).toBe(false)
    expect(isLoopbackBeyondProxy('not a url', proxied)).toBe(false)
  })
})
