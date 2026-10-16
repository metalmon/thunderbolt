import { describe, expect, test } from 'bun:test'

import { managedLaneBaseUrl } from './managed-lane'

describe('managedLaneBaseUrl', () => {
  test('desktop carries an absolute cloudUrl through', () => {
    expect(managedLaneBaseUrl('https://backend.volt.oktaplus.ru/v1', 'managed', 'http://tauri.localhost')).toBe(
      'https://backend.volt.oktaplus.ru/v1/managed',
    )
  })

  test("the web demo's same-origin cloudUrl is resolved, not handed to new URL() as a base", () => {
    expect(managedLaneBaseUrl('/v1', 'managed', 'https://demo.example')).toBe('https://demo.example/v1/managed')
  })

  test('the legacy path stays reachable for clients installed before the rename', () => {
    expect(managedLaneBaseUrl('https://x/v1', 'openrouter', 'https://x')).toBe('https://x/v1/openrouter')
  })
})
