/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { test, expect } from 'bun:test'
import { geminiLiveApiVersion, geminiLiveWsUrl } from './gemini-live-endpoint'

const nativeModel = 'gemini-2.5-flash-native-audio-preview-12-2025'
const halfCascadeModel = 'gemini-3.1-flash-live-preview'

test('geminiLiveApiVersion selects v1alpha for native-audio models', () => {
  expect(geminiLiveApiVersion(nativeModel)).toBe('v1alpha')
})

test('geminiLiveApiVersion selects v1beta for non-native-audio models', () => {
  expect(geminiLiveApiVersion(halfCascadeModel)).toBe('v1beta')
})

test('geminiLiveWsUrl builds the v1alpha BidiGenerateContent URL for a native-audio model', () => {
  const url = geminiLiveWsUrl(nativeModel, 'access_token=T')
  expect(url).toContain('v1alpha')
  expect(url).toBe(
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?access_token=T',
  )
})

test('geminiLiveWsUrl builds the v1beta BidiGenerateContent URL for a half-cascade model', () => {
  const url = geminiLiveWsUrl(halfCascadeModel, 'key=K')
  expect(url).toContain('v1beta')
  expect(url).toBe(
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=K',
  )
})

test('geminiLiveWsUrl keeps host+path+service identical across auth query styles for the same model', () => {
  const withKey = geminiLiveWsUrl(halfCascadeModel, 'key=K')
  const withToken = geminiLiveWsUrl(halfCascadeModel, 'access_token=T')
  expect(withKey.split('?')[0]).toBe(withToken.split('?')[0])
})
