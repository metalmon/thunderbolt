/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { listRepoFiles, readRepoFile } from '../testing/source-file'

/**
 * Every module that can reach OUR backend, held as a list on purpose.
 *
 * ⚠ Why a list and not a rule: the spec for autonomous mode already said which
 * lanes must go, and the implementation still shipped six leaks — the Pro row,
 * the mini-app registry, the agent-owner lookup, the hosted voice engine, the
 * product name and the Data card. Every one of them was a decision made at
 * BUILD time or in server mode standing in for a runtime one, and nothing
 * failed when it was missed. A spec nobody is forced to read is not a guard.
 *
 * So this is the guard: when a module starts talking to the backend, this test
 * goes red and whoever added it has to answer one question here —
 *
 *   what does this do on an install that has no server?
 *
 * and record the answer in `docs/development/autonomous-mode.md` beside the
 * entry. Three answers are legitimate:
 *
 *   closed  — refuses in local mode (`isLocalMode`), because the lane is ours;
 *   inert   — cannot fire without a session, which local mode never has;
 *   allowed — does not go through our backend at all (the user's own endpoint).
 *
 * Deleting a line is the same decision in reverse and just as deliberate.
 */
const backendCallers = [
  'src/acp/managed-http-adapter.ts',
  'src/ai/inference-usage-receipt.ts',
  'src/api/account.ts',
  'src/api/encryption.ts',
  'src/chats/use-hydrate-chat-store.ts',
  'src/components/auth-gate/altcha.ts',
  'src/components/auth-gate/use-auth-gate.ts',
  'src/components/device-approval.tsx',
  'src/components/logout-modal.tsx',
  'src/components/magic-link-verify.tsx',
  'src/components/settings/agents/create-agent-detail-panel.tsx',
  'src/components/share-debug-transcript/use-share-debug-transcript-state.ts',
  'src/components/sidebar-footer.tsx',
  'src/components/sso-redirect.tsx',
  'src/components/sync-setup/use-confirm-identity-state.ts',
  'src/contexts/auth-context.tsx',
  'src/contexts/sign-in-modal-context.tsx',
  'src/db/seeding/seed-agents.ts',
  'src/hooks/use-bootstrap-system-agents.ts',
  'src/hooks/use-device-session-binding.ts',
  'src/hooks/use-powersync-credentials-invalid-listener.ts',
  'src/integrations/google/auth.ts',
  'src/integrations/microsoft/auth.ts',
  'src/lib/analytics/anonymous-promotion-sso-bridge.ts',
  'src/lib/analytics/use-anonymous-promotion-analytics.ts',
  'src/lib/device-removal.ts',
  'src/lib/iroh-enrollment.ts',
  'src/lib/locations.ts',
  'src/lib/passkey.ts',
  'src/lib/returning-user-onboarding.ts',
  'src/lib/session-cache.ts',
  'src/lib/sign-in-with-otp.ts',
  'src/mini-apps/mini-app-auth.ts',
  'src/mini-apps/use-mini-apps.ts',
  'src/routes/settings/agents/index.tsx',
  'src/search/commands/use-commands.ts',
  'src/settings/preferences.tsx',
  'src/skills/telemetry.ts',
  'src/widgets/document-result/use-document-blob.ts',
]

/** How a file is found: the app's HttpClient, Better Auth, or a `/v1` base. */
const backendCallPattern = /httpClient\??\.(get|post|put|delete)\(|authClient\??\.|useSession\(\)|apiBaseUrl\(/

describe('the autonomous-mode inventory', () => {
  it('lists every module that can reach our backend, and nothing else', () => {
    const found = listRepoFiles('src')
      .filter((file) => !file.includes('.test.'))
      .filter((file) => backendCallPattern.test(readRepoFile(file)))
      .sort()

    expect(found).toEqual([...backendCallers].sort())
  })

  // The inventory is only worth keeping if the document it points at exists and
  // names the same three answers; a list with nowhere to record the decision is
  // a list nobody fills in.
  it('has a document to record each decision in', () => {
    const doc = readRepoFile('docs/development/autonomous-mode.md')
    for (const word of ['закрыт', 'мертв', 'разрешён']) {
      expect(doc).toContain(word)
    }
  })
})
