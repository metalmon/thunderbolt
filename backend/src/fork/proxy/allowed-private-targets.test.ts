/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'

import { allowsAllPrivateTargets, isAllowedPrivateTarget, parseAllowedPrivateTargets } from './allowed-private-targets'

const allowed = parseAllowedPrivateTargets(' 192.0.2.10:1234 , models.internal.example ')

describe('allowed private proxy targets', () => {
  it('allows the exact host and port the operator named', () => {
    expect(isAllowedPrivateTarget(new URL('http://192.0.2.10:1234/v1/models'), allowed)).toBe(true)
  })

  it('refuses another port on the same machine — opening a model server is not opening the host', () => {
    expect(isAllowedPrivateTarget(new URL('http://192.0.2.10:9000/'), allowed)).toBe(false)
  })

  it('allows any port when the entry names only a host', () => {
    expect(isAllowedPrivateTarget(new URL('http://models.internal.example:8080/v1'), allowed)).toBe(true)
    expect(isAllowedPrivateTarget(new URL('https://models.internal.example/v1'), allowed)).toBe(true)
  })

  it('refuses everything else, which is the whole point of a list', () => {
    expect(isAllowedPrivateTarget(new URL('http://192.0.2.11:1234/'), allowed)).toBe(false)
    expect(isAllowedPrivateTarget(new URL('http://169.254.169.254/latest/meta-data/'), allowed)).toBe(false)
  })

  it('is inert when nothing is configured', () => {
    expect(parseAllowedPrivateTargets(undefined)).toEqual([])
    expect(isAllowedPrivateTarget(new URL('http://192.0.2.10:1234/'), [])).toBe(false)
  })
})

describe('closed-perimeter switch', () => {
  it('allows any private target when the deployment declares itself closed', () => {
    expect(isAllowedPrivateTarget(new URL('http://192.0.2.99:1234/v1'), [], true)).toBe(true)
  })

  it('reads only an explicit true, so a stray value does not open the proxy', () => {
    expect(allowsAllPrivateTargets('true')).toBe(true)
    expect(allowsAllPrivateTargets(' TRUE ')).toBe(true)
    expect(allowsAllPrivateTargets('1')).toBe(false)
    expect(allowsAllPrivateTargets(undefined)).toBe(false)
  })
})

describe('link-local stays refused', () => {
  it('refuses cloud metadata even when the deployment declares itself closed', () => {
    expect(isAllowedPrivateTarget(new URL('http://169.254.169.254/latest/meta-data/'), [], true)).toBe(false)
  })

  it('still allows it when the operator names it outright', () => {
    const named = parseAllowedPrivateTargets('169.254.1.5:8080')
    expect(isAllowedPrivateTarget(new URL('http://169.254.1.5:8080/'), named, true)).toBe(true)
  })
})

describe('the blanket covers only the deployment own network', () => {
  it('refuses a public host — otherwise a caller using this to skip the https upgrade sends a key in the clear', () => {
    expect(isAllowedPrivateTarget(new URL('http://api.openai.com/v1/models'), [], true)).toBe(false)
  })

  it('accepts a single-label container or LAN name', () => {
    expect(isAllowedPrivateTarget(new URL('http://powersync:8080/probes/liveness'), [], true)).toBe(true)
  })

  it('accepts loopback and a reserved internal suffix', () => {
    expect(isAllowedPrivateTarget(new URL('http://localhost:1234/'), [], true)).toBe(true)
    expect(isAllowedPrivateTarget(new URL('http://models.internal/v1'), [], true)).toBe(true)
  })

  it('accepts a private literal address', () => {
    expect(isAllowedPrivateTarget(new URL('http://10.1.2.3:1234/v1'), [], true)).toBe(true)
  })
})
