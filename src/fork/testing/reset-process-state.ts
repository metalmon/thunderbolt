/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach } from 'bun:test'
import { usePendingQuotesStore } from '@/chats/pending-quotes-store'
import { setCurrentAgentOwner } from '@/fork/agents/agent-owner'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'

/**
 * Puts the fork's process-wide state back before every test.
 *
 * ⚠ Bun runs one process for the whole suite, so a module-level store written
 * by one file is still written when the next one starts — and with
 * `--randomize` the next one is a different file each run. That is why the
 * failure count moved between runs and why each failure passed when its file
 * was run alone: it looked like flakiness, or like upstream debt, for weeks.
 *
 * Measured: `agent-detail.test.tsx` sets the agent owner to `user-1` and never
 * clears it, so `use-hydrate-chat-store.test.tsx` later resolved a different
 * owner, found none of its custom agents and fell back to the built-in one.
 *
 * Registered from the preload, so this runs BEFORE any `beforeEach` a file
 * declares: every file starts from the shipped state and then configures what
 * it needs. A file that deliberately runs in local mode sets the store in its
 * own hook, which still wins.
 *
 * Add a line here when a new fork module keeps state outside React — one place
 * beats finding the polluter again.
 */
beforeEach(() => {
  setCurrentAgentOwner(null)
  // Upstream's, but the same hazard and the same place to fix it: a pending
  // quote left by one test rides into the next one's message. With
  // `--randomize` that happens WITHIN a file too — the test that adds a quote
  // runs before the one that asserts a clean message about as often as not.
  usePendingQuotesStore.setState({ quotesByThread: {} })
  useLocalSettingsStore.setState({
    operationMode: initialLocalSettings.operationMode,
    syncEnabled: initialLocalSettings.syncEnabled,
  })
})
