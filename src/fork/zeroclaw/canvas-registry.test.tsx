/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* src/fork/zeroclaw/canvas-registry.test.tsx */
import { describe, expect, it } from 'bun:test'
import { computeLatestByUri, deriveChipState, isGenuineClose } from './canvas-registry'
import { uiResourceArtifactId } from './ui-resource'

const msg = (parts: unknown[]) => ({ id: 'm', role: 'assistant', parts }) as never
const uiPart = (toolCallId: string, uri: string) => ({
  type: 'tool-canvas',
  toolCallId,
  state: 'output-available',
  output: { uiResource: { uri, mimeType: 'text/html', html: '<h1/>' } },
})

describe('computeLatestByUri', () => {
  it('keeps the last part per uri across messages, in order', () => {
    const map = computeLatestByUri([msg([uiPart('a', 'ui://pnl/x')]), msg([uiPart('b', 'ui://pnl/x')])], 't1')
    expect(map.get('ui://pnl/x')).toEqual({
      artifactId: uiResourceArtifactId('t1', 'ui://pnl/x'),
      latestToolCallId: 'b',
    })
  })

  it('salts artifactId by threadId: same uri in two threads yields different ids', () => {
    const messages = [msg([uiPart('a', 'ui://pnl/x')])]
    const mapA = computeLatestByUri(messages, 'thread-a')
    const mapB = computeLatestByUri(messages, 'thread-b')
    expect(mapA.get('ui://pnl/x')?.artifactId).not.toBe(mapB.get('ui://pnl/x')?.artifactId)
  })
})

describe('deriveChipState', () => {
  const artifactId = uiResourceArtifactId('t1', 'ui://pnl/x')
  const entry = (over: Partial<Parameters<typeof deriveChipState>[0]['entry'] & object> = {}) => ({
    artifactId,
    latestToolCallId: 'b',
    dismissed: false,
    dismissedAtToolCallId: null,
    ...over,
  })
  it('superseded when not the latest part', () => {
    expect(deriveChipState({ entry: entry(), toolCallId: 'a', openArtifactId: null })).toBe('superseded')
  })
  it('open when latest and shown in panel', () => {
    expect(deriveChipState({ entry: entry(), toolCallId: 'b', openArtifactId: artifactId })).toBe('open')
  })
  it('ready when latest, not open, not dismissed', () => {
    expect(deriveChipState({ entry: entry(), toolCallId: 'b', openArtifactId: null })).toBe('ready')
  })
  it('ready when dismissed with no newer emit; updated when a newer emit landed', () => {
    expect(
      deriveChipState({
        entry: entry({ dismissed: true, dismissedAtToolCallId: 'b' }),
        toolCallId: 'b',
        openArtifactId: null,
      }),
    ).toBe('ready')
    expect(
      deriveChipState({
        entry: entry({ dismissed: true, dismissedAtToolCallId: 'a' }),
        toolCallId: 'b',
        openArtifactId: null,
      }),
    ).toBe('updated')
  })
  it('superseded when entry is undefined', () => {
    expect(deriveChipState({ entry: undefined, toolCallId: 'b', openArtifactId: null })).toBe('superseded')
  })
})

describe('isGenuineClose', () => {
  it('true only when an artifact was open and the panel is now null', () => {
    expect(isGenuineClose('zc-1', null)).toBe(true)
    expect(isGenuineClose('zc-1', 'sideview')).toBe(false)
    expect(isGenuineClose('zc-1', 'preview')).toBe(false)
    expect(isGenuineClose('zc-1', 'artifact')).toBe(false)
    expect(isGenuineClose(null, null)).toBe(false)
  })
})
