# Agent Bearer Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user give a custom `remote-acp` agent (e.g. self-hosted zeroclaw) a bearer token that is stored write-only on the device and delivered as a `bearer.<token>` WebSocket subprotocol instead of in the URL.

**Architecture:** Reuse upstream's dormant local-only `agents_secrets` table (`{apiKey, authMethod}`); store the token as `{apiKey: token, authMethod: 'bearer'}`. At connect time, resolve the secret and carry it as a `Sec-WebSocket-Protocol: bearer.<token>` entry (works native + proxied; the universal proxy forwards it to the upstream). No sync, no backend change — matches upstream's documented "credentials never leave the device" policy.

**Tech Stack:** TypeScript, Drizzle + PowerSync (local-only view), React (`useReducer` form), `bun test`.

**Spec:** `docs/superpowers/specs/2026-08-15-agent-bearer-token-design.md` (Approach B). Executors read both.

## Global Constraints

- **License boundary (CLAUDE.md):** new logic goes in `src/fork/**` (additive, our header). Invasive edits to upstream files stay to one import + one call — behavior lives in the fork file. Only the transport/connect/form seams are invasive, and thin.
- **Never use `any`.** Prefer `type` over `interface`, arrow functions, `const`, early return, direct imports.
- **zeroclaw contract:** the subprotocol prefix is the bare `bearer.` (NOT `thunderbolt.bearer.`, which is Thunderbolt-cloud auth). Token is sent verbatim (no base64url) — `zc_<hex>` is subprotocol-safe.
- **Tests:** run scoped, never bare `bun test` at repo root. Use `bun test <path> --timeout 5000` for a file, `bun run test` for the full scoped suite.
- **Commits:** project rule (CLAUDE.md) — never raw `git add/commit/push`; commit via `/thunderpush`. Per-task "Commit" steps below mean "stage + commit these files via /thunderpush" (batching per reviewer checkpoint is fine).
- **Bearer applies to `transport: 'websocket'` only.** `iroh` remote-acp returns before the WebSocket factory; no subprotocol channel there (out of scope).

---

## Phase 1 — Core: token stored on add + delivered as bearer

### Task 1: `buildAgentSubprotocols` helper (additive)

**Files:**
- Create: `src/fork/agent-bearer/subprotocols.ts`
- Test: `src/fork/agent-bearer/subprotocols.test.ts`

**Interfaces:**
- Produces: `buildAgentSubprotocols(token: string | null | undefined): string[] | undefined`
  — returns `['zeroclaw.v1', 'bearer.' + token]` for a non-empty token, else `undefined`.
- Produces: `agentBearerSubprotocolPrefix = 'bearer.'`, `zeroclawCarrierSubprotocol = 'zeroclaw.v1'` (exported consts).

- [ ] **Step 1: Write the failing test**

```ts
// src/fork/agent-bearer/subprotocols.test.ts
import { describe, expect, it } from 'bun:test'
import { buildAgentSubprotocols } from './subprotocols'

describe('buildAgentSubprotocols', () => {
  it('returns carrier + bearer entry for a token', () => {
    expect(buildAgentSubprotocols('zc_abc123')).toEqual(['zeroclaw.v1', 'bearer.zc_abc123'])
  })

  it('returns undefined for null / undefined / empty', () => {
    expect(buildAgentSubprotocols(null)).toBeUndefined()
    expect(buildAgentSubprotocols(undefined)).toBeUndefined()
    expect(buildAgentSubprotocols('')).toBeUndefined()
    expect(buildAgentSubprotocols('   ')).toBeUndefined()
  })

  it('sends the token verbatim (no encoding)', () => {
    const t = 'zc_0123456789abcdef'
    expect(buildAgentSubprotocols(t)).toEqual(['zeroclaw.v1', `bearer.${t}`])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/fork/agent-bearer/subprotocols.test.ts --timeout 5000`
Expected: FAIL — module not found / `buildAgentSubprotocols` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork helper: build the `Sec-WebSocket-Protocol` list that carries a
 * user-configured agent bearer token to a zeroclaw gateway.
 *
 * zeroclaw's `extract_ws_token` reads `bearer.<token>` (bare `bearer.` prefix,
 * plain `strip_prefix`, no decode). We also offer `zeroclaw.v1` so the server
 * can echo a selected subprotocol (RFC 6455). This is deliberately distinct
 * from `thunderbolt.bearer.` (Thunderbolt cloud auth) — do not unify them.
 */

/** Carrier offered alongside the bearer so zeroclaw can echo a subprotocol. */
export const zeroclawCarrierSubprotocol = 'zeroclaw.v1'

/** zeroclaw bearer subprotocol prefix. Bare `bearer.`, NOT `thunderbolt.bearer.`. */
export const agentBearerSubprotocolPrefix = 'bearer.'

/**
 * Build the subprotocol list for a custom agent's bearer token.
 * Returns `undefined` when no usable token is present so callers fall back to
 * the exact current (tokenless) WebSocket construction.
 */
export const buildAgentSubprotocols = (token: string | null | undefined): string[] | undefined => {
  const trimmed = token?.trim()
  if (!trimmed) {
    return undefined
  }
  return [zeroclawCarrierSubprotocol, `${agentBearerSubprotocolPrefix}${trimmed}`]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/fork/agent-bearer/subprotocols.test.ts --timeout 5000`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

Commit `src/fork/agent-bearer/subprotocols.ts` + test via `/thunderpush` — message: `feat(fork/agent-bearer): add buildAgentSubprotocols helper`.

---

### Task 2: Thread `agentAuthToken` through the transport factory

**Files:**
- Modify: `src/acp/transports/index.ts` (`OpenTransportInputs`, `resolveWebSocketFactory`)
- Test: `src/acp/transports/index.test.ts`

**Interfaces:**
- Consumes: `buildAgentSubprotocols` (Task 1).
- Produces: `OpenTransportInputs.agentAuthToken?: string | null`. For `remote-acp` + `websocket`, the returned factory constructs the WebSocket with `buildAgentSubprotocols(agentAuthToken)`; when the token is absent the constructed socket is byte-identical to today's (no `protocols` arg native; unchanged proxy protocols).

- [ ] **Step 1: Write the failing test**

Add to `src/acp/transports/index.test.ts` (mirror the existing factory tests; inject `webSocketFactory` to capture args):

```ts
it('remote-acp native standalone passes the bearer subprotocols when a token is set', async () => {
  const seen: Array<{ url: string; protocols?: string[] }> = []
  const webSocketFactory = ((url: string, protocols?: string[]) => {
    seen.push({ url, protocols })
    return { addEventListener() {}, removeEventListener() {}, close() {}, send() {} } as unknown as WebSocketLike
  }) as WebSocketFactory

  await openTransport({
    url: 'wss://gw.example/acp?agent=gost',
    transport: 'websocket',
    agentType: 'remote-acp',
    signal: new AbortController().signal,
    isStandalone: () => true,
    readProxyEnabled: () => null, // proxy off → native
    agentAuthToken: 'zc_deadbeef',
    webSocketFactory,
  })

  expect(seen[0]?.protocols).toEqual(['zeroclaw.v1', 'bearer.zc_deadbeef'])
})

it('remote-acp native standalone passes NO protocols when there is no token (regression)', async () => {
  const seen: Array<{ url: string; protocols?: string[] }> = []
  const webSocketFactory = ((url: string, protocols?: string[]) => {
    seen.push({ url, protocols })
    return { addEventListener() {}, removeEventListener() {}, close() {}, send() {} } as unknown as WebSocketLike
  }) as WebSocketFactory

  await openTransport({
    url: 'wss://gw.example/acp?agent=gost',
    transport: 'websocket',
    agentType: 'remote-acp',
    signal: new AbortController().signal,
    isStandalone: () => true,
    readProxyEnabled: () => null,
    agentAuthToken: null,
    webSocketFactory,
  })

  expect(seen[0]?.protocols).toBeUndefined()
})
```

> Note: the injected `webSocketFactory` short-circuits `resolveWebSocketFactory`. To test the *resolved* factory, the test must NOT pass `webSocketFactory` and instead stub `resolveWebSocketFactory`'s native path. Simplest: keep `webSocketFactory` injected but assert that `openTransport` forwards it the resolved `protocols`. Since production omits `webSocketFactory` and builds the real one, add a second layer: export `resolveWebSocketFactory` and test it directly (below).

- [ ] **Step 2: Add a direct `resolveWebSocketFactory` unit test**

```ts
import { resolveWebSocketFactory } from './index'
// remote-acp native, token present:
const factory = resolveWebSocketFactory({
  url: 'wss://gw/acp', transport: 'websocket', agentType: 'remote-acp',
  signal: new AbortController().signal, isStandalone: () => true, readProxyEnabled: () => null,
  agentAuthToken: 'zc_x',
})
// Replace global WebSocket with a capturing stub for this assertion, then:
factory('wss://gw/acp')
// expect the stub saw protocols ['zeroclaw.v1','bearer.zc_x']
```

Run: `bun test src/acp/transports/index.test.ts --timeout 5000`
Expected: FAIL — `agentAuthToken` not on the input type / protocols not forwarded.

- [ ] **Step 3: Implement**

In `src/acp/transports/index.ts`:

1. Add the import:

```ts
import { buildAgentSubprotocols } from '@/fork/agent-bearer/subprotocols'
```

2. Add the field to `OpenTransportInputs`:

```ts
  /** User-configured bearer token for a remote-acp agent (zeroclaw). Carried as
   *  a `bearer.<token>` subprotocol. Absent → current tokenless construction. */
  agentAuthToken?: string | null
```

3. In `resolveWebSocketFactory`, change the `remote-acp` branches to use the token. Export the function for testability:

```ts
export const resolveWebSocketFactory = (inputs: OpenTransportInputs): WebSocketFactory => {
  if (inputs.agentType === 'managed-acp') {
    return resolveManagedAcpFactory(inputs)
  }
  const agentProtocols = buildAgentSubprotocols(inputs.agentAuthToken)
  if (isStandaloneTransport(inputs.isStandalone, inputs.readProxyEnabled)) {
    return (url) => new WebSocket(url, agentProtocols) as unknown as WebSocketLike
  }
  const proxyWs = createProxyWebSocket({
    cloudUrl: cloudWsUrl(),
    isStandalone: inputs.isStandalone,
    getAuthToken: inputs.getAuthToken,
  })
  return (url) => proxyWs(url, agentProtocols) as unknown as WebSocketLike
}
```

> `new WebSocket(url, undefined)` is spec-equivalent to `new WebSocket(url)` — the regression test asserts `protocols` is `undefined` when tokenless, satisfying "byte-identical".

- [ ] **Step 4: Run tests**

Run: `bun test src/acp/transports/index.test.ts --timeout 5000`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

Commit `src/acp/transports/index.ts` + test via `/thunderpush` — `feat(acp): carry remote-acp bearer token as a ws subprotocol`.

---

### Task 3: Resolve the stored secret and pass it to the transport

**Files:**
- Modify: `src/acp/acp-adapter.ts` (`AcpAdapterDeps`, `connectAcpAdapter`)
- Modify: `src/acp/connect.ts` (default `getAgentAuthToken` wiring)
- Test: `src/acp/acp-adapter.test.ts`

**Interfaces:**
- Consumes: `getAgentSecrets(db, id)` from `@/dal` (upstream, existing) → `{ apiKey, authMethod } | null`.
- Produces: `AcpAdapterDeps.getAgentAuthToken?: (agentId: string) => Promise<string | null>`; `connectAcpAdapter` calls it and forwards the result as `openTransport({ ..., agentAuthToken })`. Default resolves `getAgentSecrets(getDb(), id)` and returns `apiKey` only when `authMethod === 'bearer'`, else `null`.

- [ ] **Step 1: Write the failing test**

Add to `src/acp/acp-adapter.test.ts` — inject `openTransport` + `getAgentAuthToken` and assert the token reaches the transport:

```ts
it('forwards the bearer token to openTransport for remote-acp', async () => {
  let seenToken: string | null | undefined = 'UNSET'
  const openTransport = (async (inputs) => {
    seenToken = inputs.agentAuthToken
    return makeFakeTransport() // existing test helper returning an AcpTransport
  }) as AcpAdapterDeps['openTransport']

  await connectAcpAdapter(
    remoteAcpAgentFixture, // { type:'remote-acp', transport:'websocket', url:'wss://gw/acp', id:'a1', ... }
    { httpClient: fakeHttpClient },
    {
      openTransport,
      ClientSideConnection: FakeConnection, // existing test double
      getAgentAuthToken: async () => 'zc_secret',
    },
  )

  expect(seenToken).toBe('zc_secret')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/acp/acp-adapter.test.ts --timeout 5000`
Expected: FAIL — `getAgentAuthToken` not a dep / `agentAuthToken` never set.

- [ ] **Step 3: Implement**

In `src/acp/acp-adapter.ts`:

1. Add to `AcpAdapterDeps`:

```ts
  /** Resolve a remote-acp agent's bearer token (local-only secret). Production
   *  reads `agents_secrets` via the DAL; tests inject. Returns null when there
   *  is no bearer secret. */
  getAgentAuthToken?: (agentId: string) => Promise<string | null>
```

2. In `connectAcpAdapter`, before building the transport, resolve the token and pass it:

```ts
  const agentAuthToken =
    agent.type === 'remote-acp' && deps.getAgentAuthToken ? await deps.getAgentAuthToken(agent.id) : null

  const transport = await transportFactory({
    url: agent.url,
    transport: agent.transport,
    agentType: agent.type,
    signal: transportController.signal,
    webSocketFactory: deps.webSocketFactory,
    httpClient: ctx.httpClient,
    agentAuthToken,
  })
```

In `src/acp/connect.ts`, wire the production default (mirror the existing `getEnabledSkills` default):

```ts
import { getAgentSecrets } from '@/dal'
// ...
const resolveAgentAuthToken = async (agentId: string): Promise<string | null> => {
  const secret = await getAgentSecrets(getDb(), agentId)
  return secret?.authMethod === 'bearer' ? secret.apiKey : null
}
// in connectAcpAdapter(...) deps:
getAgentAuthToken: deps.getAgentAuthToken ?? resolveAgentAuthToken,
```

- [ ] **Step 4: Run tests**

Run: `bun test src/acp/acp-adapter.test.ts src/acp/connect.test.ts --timeout 5000`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit the three files via `/thunderpush` — `feat(acp): resolve remote-acp bearer secret at connect`.

---

### Task 4: Clear the secret on agent delete

**Files:**
- Modify: `src/dal/agents.ts` (`deleteAgent`)
- Test: `src/dal/agents.test.ts`

**Interfaces:**
- Consumes: existing `setAgentSecrets(db, id, { apiKey, authMethod })`.
- Produces: `deleteAgent` also clears the local secret so a deleted agent leaves no dead credential.

- [ ] **Step 1: Write the failing test**

```ts
it('clears the local secret when the agent is deleted', async () => {
  const db = getDb()
  await createAgent(db, { id: 'del-1', name: 'X', type: 'remote-acp', transport: 'websocket', url: 'wss://g/a', userId: 'u1' })
  await setAgentSecrets(db, 'del-1', { apiKey: 'zc_x', authMethod: 'bearer' })

  await deleteAgent(db, 'del-1')

  expect(await getAgentSecrets(db, 'del-1')).toEqual({ apiKey: null, authMethod: null })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dal/agents.test.ts --timeout 5000`
Expected: FAIL — secret still present after delete.

- [ ] **Step 3: Implement**

In `deleteAgent`, after the soft-delete update and before/after `disposeAdapter(id)`:

```ts
  await setAgentSecrets(db, id, { apiKey: null, authMethod: null })
```

(Place it inside `deleteAgent` so the local credential is scrubbed alongside the soft-delete.)

- [ ] **Step 4: Run tests**

Run: `bun test src/dal/agents.test.ts --timeout 5000`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit via `/thunderpush` — `fix(acp): scrub local agent bearer secret on delete`.

---

### Task 5: Add the token field to the add-agent form + save it

**Files:**
- Modify: `src/components/settings/agents/add-custom-agent-form.tsx` (state, action, field, payload)
- Modify: `src/components/settings/agents/create-agent-detail-panel.tsx` (`handleAdd` persists the secret)
- Test: `src/routes/settings/agents/index.test.tsx` (or a colocated form test)

**Interfaces:**
- Consumes: `setAgentSecrets` from `@/dal`.
- Produces: `AddCustomAgentPayload.authToken: string | null`. `handleAdd` calls `createAgent(...)` then, when `authToken` is non-null, `setAgentSecrets(db, id, { apiKey: authToken, authMethod: 'bearer' })`.

- [ ] **Step 1: Write the failing test**

Assert that typing a token and submitting persists a bearer secret. In the form-level test, submit with a token via the existing `onSubmit` spy and assert the payload carries `authToken`:

```ts
it('includes the entered access token in the submit payload', async () => {
  const onSubmit = mock(async () => {})
  render(<AddCustomAgentForm onSubmit={onSubmit} testAcpConnection={async () => ({ success: true })} />)
  await userType(screen.getByLabelText(/name/i), 'GOST')
  await userType(screen.getByLabelText(/url/i), 'wss://gw.example/acp?agent=gost')
  await userClick(screen.getByRole('button', { name: /test connection/i }))
  await userType(screen.getByLabelText(/access token/i), 'zc_abc')
  await userClick(screen.getByRole('button', { name: /add agent/i }))
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ authToken: 'zc_abc' }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/settings/agents --timeout 5000` (adjust to the test path)
Expected: FAIL — no "Access token" field / payload lacks `authToken`.

- [ ] **Step 3: Implement the form changes**

In `add-custom-agent-form.tsx`:

1. Extend the payload type:

```ts
export type AddCustomAgentPayload = {
  name: string
  url: string
  description: string | null
  transport: CustomAgentTransport
  authToken: string | null
}
```

2. Extend state + action:

```ts
type AgentFormState = { /* ...existing... */ authToken: string }
type AgentFormAction =
  | { /* ...existing... */ }
  | { type: 'TOKEN_CHANGED'; value: string }
```

3. `emptyState`: add `authToken: ''`. Reducer: add
   `case 'TOKEN_CHANGED': return { ...state, authToken: action.value }`.

4. Compute `const trimmedToken = state.authToken.trim()` and include in the
   `onSubmit` call: `authToken: trimmedToken.length > 0 ? trimmedToken : null`.

5. Render the field below the URL block:

```tsx
<div className="grid grid-cols-1 gap-2">
  <Label htmlFor="agent-token">{t('agents.authToken')}</Label>
  <Input
    id="agent-token"
    type="password"
    placeholder={t('agents.authTokenPlaceholder')}
    value={state.authToken}
    onChange={(e) => dispatch({ type: 'TOKEN_CHANGED', value: e.target.value })}
    autoComplete="off"
    autoCapitalize="none"
    autoCorrect="off"
    spellCheck={false}
  />
  <p className="text-[length:var(--font-size-xs)] text-muted-foreground">{t('agents.authTokenHelper')}</p>
</div>
```

6. Pass `authToken` to `testAcpConnection` if/when that probe is extended
   (Task 6-integration); for now the probe signature is unchanged.

In `create-agent-detail-panel.tsx` `handleAdd`, after `createAgent(...)`:

```ts
if (payload.authToken) {
  await setAgentSecrets(db, id, { apiKey: payload.authToken, authMethod: 'bearer' })
}
```

(where `id` is the `uuidv7()` already generated for `createAgent`; hoist it to a
`const id = uuidv7()` so both calls share it.)

- [ ] **Step 4: Run tests**

Run: `bun test src/components/settings/agents --timeout 5000`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit both components + test via `/thunderpush` — `feat(agents): add optional access-token field to add-agent form`.

---

### Task 6: Locale strings (additive, fork IP)

**Files:**
- Modify: RU + EN `settings` catalogs under `locales/**` (the `fork/i18n-locales` surface). Add keys: `agents.authToken`, `agents.authTokenPlaceholder`, `agents.authTokenHelper`.

- [ ] **Step 1: Add the keys**

EN (example):
```json
"authToken": "Access token",
"authTokenPlaceholder": "Paste the agent access token",
"authTokenHelper": "Sent as a bearer credential, not in the URL. Stored only on this device."
```
RU (example):
```json
"authToken": "Токен доступа",
"authTokenPlaceholder": "Вставьте токен доступа агента",
"authTokenHelper": "Передаётся как bearer, не в URL. Хранится только на этом устройстве."
```

- [ ] **Step 2: Typecheck + i18n**

Run: `bun run test` (full scoped suite) and the project typecheck (`/thundercheck` or `bunx tsc --noEmit`).
Expected: PASS; no missing-key warnings for the new keys.

- [ ] **Step 3: Commit**

Commit the catalogs via `/thunderpush` — `feat(i18n): agent access-token strings (RU/EN)`.

---

### Task 7: Full-suite green + manual gate note

- [ ] **Step 1:** Run `bun run test` (scoped src/ + shared/) — expect all green.
- [ ] **Step 2:** Run the project typecheck (`/thundercheck`) — expect no TS errors.
- [ ] **Step 3:** Record the manual gates to run against a real zeroclaw (see spec §11): pairing-required auth success + wrong-token 401; proxied/web path reaches zeroclaw with the bearer; second device shows the agent row but no token until re-entered.

---

## Phase 2 — Edit existing agent's token (follow-up)

> **Gate:** before writing code, READ `src/components/settings/agents/agent-detail.tsx` and its test to locate the edit form and its state shape. The tasks below describe intent; fill in exact signatures from that file.

### Task 8: Populated indicator + change/clear on the edit surface

**Files:**
- Modify: `src/components/settings/agents/agent-detail.tsx` (edit form)
- Test: `src/components/settings/agents/agent-detail.test.tsx`

**Behavior:**
- On mount for a `remote-acp` agent, read `getAgentSecrets(db, agent.id)`; if
  `apiKey != null`, render the token field empty with a populated indicator
  (e.g. placeholder `••••••` + "token set" caption), never the value.
- Empty on save → keep existing (do not call `setAgentSecrets`).
- A typed value → `setAgentSecrets(db, id, { apiKey: value, authMethod: 'bearer' })`.
- A "Clear token" affordance → `setAgentSecrets(db, id, { apiKey: null, authMethod: null })`.
- Editing the token does NOT need to dispose the ACP adapter unless the wire
  identity changed; but a token change should force reconnect. Reuse
  `disposeAdapter(id)` after a token write so the next chat picks up the new
  credential.

- [ ] Write failing test for populated indicator (secret present → indicator shown, value not rendered).
- [ ] Write failing test for clear (calls `setAgentSecrets` with nulls + `disposeAdapter`).
- [ ] Implement, run, commit via `/thunderpush`.

### Task 9: Bearer-aware test-connection (optional hardening)

**Files:**
- Modify: `src/acp` test-connection entry (`testAcpConnection`) + `src/components/settings/agents/add-custom-agent-form.tsx` (pass token to the probe).

**Behavior:** the "Test connection" probe opens its WebSocket with
`buildAgentSubprotocols(formToken)` so it exercises the real auth path (a
pairing-required zeroclaw rejects a tokenless probe). Thread the current form
token into `testAcpConnection({ url, authToken })`.

- [ ] Write failing test (probe receives the bearer subprotocols when a token is set).
- [ ] Implement, run, commit via `/thunderpush`.

---

## Self-Review notes

- **Spec coverage:** §3 storage → Tasks 5/4; §5 transport matrix → Task 2; §7 UI → Tasks 5 (add) + 8 (edit); §8 wiring → Tasks 2/3, cleanup → Task 4; §11 tests → each task + Task 7. OAuth (`authMethod:'oauth'`) intentionally unimplemented — connect returns `null` for it (Task 3), matching non-goals.
- **Type consistency:** `getAgentAuthToken(agentId) => Promise<string|null>`, `agentAuthToken?: string|null`, `buildAgentSubprotocols(token) => string[]|undefined`, payload `authToken: string|null` — consistent across Tasks 1/2/3/5.
- **No sync / no backend / no schema change** — confirmed against spec §2/§6; nothing here touches PowerSync sync rules or `backend/**`.
